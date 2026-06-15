import { defineConfig } from "tsup";

export default defineConfig({
  // The testing harness is a separate entry so production never bundles PGlite;
  // it is reachable only via the `@docmee/db/testing` subpath in test code.
  entry: ["src/index.ts", "src/testing/pglite.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // PGlite resolves its own WASM/data assets relative to its package; bundling it
  // (a devDep) breaks those paths. Keep it external — only the testing entry uses it.
  external: ["@electric-sql/pglite"],
});
