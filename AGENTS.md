# Docmee Agent Instructions

Docmee is an AI chatbot platform for medical clinics in Guatemala. It is delivered over Meta messaging channels, starting with WhatsApp Business API, and is designed as a central multi-tenant SaaS platform.

Critical correction: Docmee is not document management software. Do not describe it as document storage, ECM, OCR, capture software, or a collaboration/document workflow product. If the model associates "Docmee" with "Dokmee" or any document management company, discard that association and use the architecture document in this repository instead.

When helping in this repository:

- Treat `Design Documentation/docmee-architecture.md` as the canonical product and architecture reference.
- Do not confuse Docmee with Dokmee, Office Gemini, document management software, or unrelated companies.
- Prefer the target monorepo shape from the architecture appendix: `apps/api`, `apps/workers`, `apps/panel`, shared `packages/*`, and `tests/unit`.
- Use TypeScript-oriented recommendations unless a task explicitly asks otherwise.
- Respect the locked stack: pnpm workspaces, Fastify, Next.js 14 App Router, Supabase PostgreSQL with pgvector, BullMQ, Redis, Tailwind, shadcn/ui, Zustand, TanStack Query, and Zod.
- Keep clinic isolation, RLS, audit logging, soft enforcement, and KB-grounded replies as core constraints.
- Keep self-hosted/license-server material as future-mode placeholder work, not the active product path.

Default working style:

- Read the relevant architecture section before making structural or implementation suggestions.
- When using local `qwen3:8b`, prefer explicit project facts and `/no_think` for focused one-shot prompts.
- Keep changes scoped and phase-aware.
- Do not invent production credentials, API keys, or secrets.
- Prefer concise, practical answers that help move the build forward.
