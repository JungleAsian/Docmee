// Shared flat ESLint config for Docmee packages.
// Kept intentionally lean: type-aware correctness rules + the SEC16 guardrail
// (no console logging of arbitrary data — use the redacting logger in @docmee/core).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import('typescript-eslint').ConfigArray} */
export const base = tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "**/*.gen.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      // SEC16: never log message bodies / PHI. console.* is banned platform-wide;
      // use the redacting logger from @docmee/core instead.
      "no-console": "error",
      // Allow `== null` / `!= null` (idiomatic null+undefined check); strict elsewhere.
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Tests and tooling may use console.
    files: ["**/*.test.ts", "**/*.spec.ts", "**/scripts/**", "**/*.config.*"],
    rules: { "no-console": "off" },
  },
);
