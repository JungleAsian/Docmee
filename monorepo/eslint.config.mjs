// Root flat ESLint config. ESLint walks up from each package dir to find this file,
// so `eslint .` in any workspace package uses the shared Docmee rules.
import { base } from "./packages/config/eslint.base.mjs";

export default [
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/*.gen.ts"] },
  ...base,
];
