import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // bullmq/ioredis are heavy native-ish deps — keep external, resolve at runtime.
  external: ["bullmq", "ioredis"],
});
