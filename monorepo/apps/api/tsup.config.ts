import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli/migrate.ts", "src/cli/bootstrap.ts", "src/cli/seed-clinic.ts"],
  format: ["esm"],
  target: "node20",
  dts: false,
  clean: true,
  sourcemap: true,
});
