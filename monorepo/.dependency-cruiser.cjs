/**
 * Docmee import-boundary rules — enforces the FE/BE seam in CI.
 * Run: pnpm lint:boundaries
 */
module.exports = {
  forbidden: [
    {
      name: "fe-no-backend-internals",
      comment: "Frontend (apps/web, packages/ui) may import ONLY from packages/contracts and packages/ui — never backend internals.",
      severity: "error",
      from: { path: "^(apps/web|packages/ui)" },
      to: {
        path: "^(apps/api|apps/worker|packages/db|packages/core|packages/channels|packages/llm|packages/agents|packages/integrations)",
      },
    },
    {
      name: "be-no-frontend",
      comment: "Backend must never import frontend code.",
      severity: "error",
      from: { path: "^(apps/api|apps/worker|packages/db|packages/core|packages/channels|packages/llm|packages/agents|packages/integrations)" },
      to: { path: "^(apps/web|packages/ui)" },
    },
    {
      name: "no-circular",
      comment: "No circular dependencies.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
  },
};
