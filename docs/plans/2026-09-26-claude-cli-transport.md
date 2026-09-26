# Claude CLI Transport Design

## Objective
Add a disabled-by-default, per-clinic `claude_cli` chat transport for Docmee-managed Claude subscription capacity. It is available only to approved staff-facing AI surfaces (J.zel and the workflow wizard), never patient-facing automation.

## Scope
- Add the `claude_cli` provider type and a Node process adapter in `@docmee/llm`.
- Run a fresh non-interactive `claude -p` process for each request, with a clinic identifier, restricted mode, no tools/MCP, no session persistence, a bounded timeout, output cap, and in-memory global/per-clinic limits.
- Permit selection only to `ia_studio_admin` users; retain the existing provider unless a superuser explicitly changes the clinic configuration.
- Preserve existing clinic KB/configuration isolation by passing the normal, already clinic-scoped J.zel request context through the same gateway.

## Non-goals
- Installing Claude Code, authenticating a subscription, saving a subscription session, or setting production environment values.
- Using a clinic-owned OAuth credential, storing credentials in clinic settings, changing an Anthropic API key, or changing the configured model.
- Patient replies, worker automation, appointments, KB changes, `docmee.ai`, or automatic API fallback.

## Safety and data boundary
The adapter rejects calls unless `CLAUDE_CLI_ENABLED=true`, a positive per-clinic quota exists, an explicit staff context is supplied, and a clinic ID is present. It removes `ANTHROPIC_API_KEY` from the child environment. Request data travels only on child stdin, never command arguments, logs, or error text. A CLI error, quota exhaustion, timeout, no output, or unavailable binary returns a generic unavailable error; it never retries through the paid API.

The Claude CLI process uses `--restricted`, `--tools ""`, `--disallowedTools mcp__*`, `--permission-prompts none`, `--no-session-persistence`, and `--max-turns 1`. Process state and per-clinic counters are discarded on restart. Patient code paths do not provide the required staff context and therefore fail closed if they are somehow configured with this provider.

## Configuration and activation
`clinics.settings.aiAssistant.chatProvider = "claude_cli"` is the per-clinic opt-in. Existing clinics continue to default to `claude`; the runtime remains disabled until a separately authorized host configuration and subscription authentication is completed. Only a superuser can select or modify the CLI transport. Before activation, Patrick must authorize the exact subscription account, provider data handling, host secret/session custody, and a redacted staff-only readiness test.

## Acceptance evidence
- Unit coverage proves disabled, no-staff-context, quota, timeout, and non-leaking child-process behavior.
- API/UI tests prove the provider parses and superuser gate is enforced.
- Full touched-package checks pass at the committed SHA.
- Push state is verified independently. Deployment is attempted only from a non-root AWS identity and proven with the public health build ID.