import { buildApp } from "./app.js";
import { loadEnv } from "@docmee/core";

async function main(): Promise<void> {
  const env = loadEnv();
  const app = buildApp({ env });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // Logger may not exist yet if env failed to load; stderr is the last resort.
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
