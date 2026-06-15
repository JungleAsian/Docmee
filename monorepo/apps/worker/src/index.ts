import { loadEnv, createLogger } from "@docmee/core";
import { Keyring, createDatabase, type Database } from "@docmee/db";
import { createWhatsAppTransport } from "@docmee/agents";
import { runScheduledTick } from "./scheduler.js";

const TICK_MS = 30 * 60 * 1000; // every 30 minutes (architecture §12)
const log = createLogger({ name: "worker" });

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) {
    log.error("DATABASE_URL not set — worker requires a database (X6). Exiting.");
    process.exit(1);
  }
  const keyring = Keyring.fromEnv();
  if (!keyring) {
    log.error("Encryption keys not set (MASTER_KEY/HMAC_KEY). Exiting.");
    process.exit(1);
  }

  const db: Database = createDatabase({
    databaseUrl: env.DATABASE_URL,
    adminDatabaseUrl: env.DATABASE_ADMIN_URL ?? env.DATABASE_URL,
  });
  const transport = createWhatsAppTransport({
    db,
    keyring,
    log: (m) => log.info(m),
  });

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      const summary = await runScheduledTick({ db, keyring, transport });
      log.info(summary, "scheduled tick complete");
    } catch (err) {
      log.error({ err }, "scheduled tick failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), TICK_MS);
  void tick(); // run once at startup

  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    await db.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  log.info({ tickMs: TICK_MS }, "worker started");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal worker startup error:", err);
  process.exit(1);
});
