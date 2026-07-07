# @docmee/deploykit — Installer (DeployKit)

A Tauri-based Windows/macOS installer that gets a clinic operator from zero to a
running Docmee stack:

1. **Preflight** — Node 20+, disk space, internet connectivity
2. **Download** — pulls the latest release from GitHub (`GITHUB_REPO`)
3. **Install deps** — Node (verified), Redis and PM2 (installed if missing)
4. **Configure** — a setup wizard collects every `.env` secret
5. **Start** — boots the four services via `pm2 start tools/deploy/ecosystem.config.cjs`
6. **Verify** — polls `/health` until it returns 200
7. **Complete** — opens `http://localhost:3000`

## Architecture

- `src/main.ts` — the orchestrator (`runInstaller`) and `InstallerState` machine.
- `src/steps/*` — one module per install step (preflight, download, install-deps,
  configure, start, verify). All step logic lives in TypeScript so it is the
  single source of truth.
- `src/progress-emitter.ts` / `src/github-configurator.ts` — the typed progress
  bus and GitHub release helpers (Gap #21).
- `src/installer-runner.ts` / `src/system-check.ts` — Node entry points the Tauri
  host spawns; they stream `InstallerState` as NDJSON on stdout.
- `src/ui/*` — the five-screen React + Tailwind wizard rendered in the webview.
- `src-tauri/*` — the Rust shell. It spawns the Node entry points and
  re-broadcasts progress to the webview as `installer://progress` events.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm build` | Compile the TypeScript (orchestrator + UI) with `tsc` |
| `pnpm build:web` | Bundle the webview frontend with Vite |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm lint` | Lint `src` |
| `pnpm test` | Run the unit tests (Vitest) |
| `pnpm tauri build` | Produce the platform installer (requires the Rust toolchain) |
