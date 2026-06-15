import { buildApp } from "./app.js";
import { loadEnv, type NormalizedInbound } from "@docmee/core";
import { Keyring, createDatabase, type Database } from "@docmee/db";
import { BullMqQueueProvider, type QueueProvider } from "@docmee/queue";

async function main(): Promise<void> {
  const env = loadEnv();

  const keyring = Keyring.fromEnv() ?? undefined;
  const db: Database | undefined = env.DATABASE_URL
    ? createDatabase({
        databaseUrl: env.DATABASE_URL,
        adminDatabaseUrl: env.DATABASE_ADMIN_URL,
      })
    : undefined;

  // With Redis, the API only ENQUEUES inbound (200-OK-first → enqueue, decision #6);
  // the worker consumes. Without Redis, buildApp's default processes inline.
  let queue: QueueProvider | undefined;
  let onInbound: ((msgs: NormalizedInbound[]) => Promise<void>) | undefined;
  if (env.REDIS_URL) {
    queue = new BullMqQueueProvider(env.REDIS_URL);
    const inbound = queue.queue<NormalizedInbound>("inbound");
    onInbound = async (msgs) => {
      await Promise.all(msgs.map((m) => inbound.add(m)));
    };
  }

  const app = buildApp({ env, db, keyring, onInbound });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    if (queue) await queue.close();
    if (db) await db.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
