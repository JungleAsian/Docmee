# Workflow Diagnostics Design

**Date:** 2026-10-01

**Status:** Approved design; implementation planning pending

**Product area:** Admin Studio / Workflow automation
**Decision owner:** Docmee product owner

## Objective contract

### Objective

Give Docmee platform superusers a safe, clinic-scoped way to determine whether a workflow is structurally valid, whether representative paths behave correctly, whether its dependencies are ready, and where recent executions failed.

### Scope

- Add a superuser-only **Diagnose workflow** action to the existing workflow editor.
- Diagnose the current editor graph, including unsaved changes, without publishing or mutating it.
- Reuse the existing structured workflow validator, deterministic simulator, redacted execution traces, and credential/readiness mechanisms.
- Return one structured report containing workflow checks, safe simulation results, integration readiness, and recent run evidence.
- Audit diagnostic use without storing patient content or secret material.

### Non-goals

- No second workflow engine or alternative execution contract.
- No automatic workflow repair, save, publish, activation, or rollback.
- No patient-facing messages, appointments, patient-record changes, queued jobs, or other production side effects.
- No display of credentials, environment variables, raw provider payloads, or unredacted patient data.
- No guarantee that a provider will accept or deliver a future live message.

### Constraints and dependencies

- Access is limited to the `ia_studio_admin` platform-superuser role in both UI and API enforcement.
- Every request remains scoped to an explicitly selected clinic and workflow.
- Validation and simulation must share the same node types, ports, routing rules, and execution semantics used by the runtime.
- Integration checks must be read-only, bounded by timeouts, and safe to repeat.
- Results must remain useful when a provider is unavailable: one failed integration check must not hide graph or simulation findings.

### Acceptance evidence

- Permission tests prove every non-superuser role is denied before repository or provider access.
- Clinic-isolation tests prove a superuser cannot diagnose a workflow outside the explicitly resolved clinic scope.
- Invalid-graph tests identify affected node or edge IDs and give actionable remediation.
- Simulation tests prove synthetic inputs and zero production side effects.
- Integration tests prove secret redaction and independent timeout/error handling.
- UI tests prove findings can focus the affected workflow step and that unsaved graphs can be diagnosed.
- Applicable lint, type checks, focused tests, full relevant suites, and build pass before release.

### Gates and stop condition

- This document requires owner review before implementation planning.
- Production deployment remains a separate release action.
- Implementation is execution-complete only after local verification and review; owner acceptance remains separate.

## Approaches considered

### Static validation only

This is the smallest implementation but cannot distinguish a well-shaped graph from a workflow whose WhatsApp, Calendar, AI, KB, doctor, service, or referenced-workflow dependency is unavailable.

### Full live end-to-end execution

This gives the highest fidelity but risks sending patient messages or creating operational records. It also makes repeatable diagnosis dependent on provider state and test identities. It is not appropriate for the default troubleshooting tool.

### Layered diagnostics in the existing workflow editor

This is the selected approach. It combines deterministic graph validation, side-effect-free scenario simulation, read-only dependency readiness, and redacted recent-run evidence. It reuses existing implementation paths and keeps each evidence class visibly distinct.

## User experience

### Entry point

The workflow editor toolbar adds **Diagnose workflow** beside the existing simulation and lifecycle actions. The action is rendered only when the authenticated user role is `ia_studio_admin` and a clinic is selected. A brand-new workflow must be saved as a draft once before diagnosis so it has a clinic-scoped workflow ID; later unsaved editor changes may be supplied in the diagnostic request without being persisted.

Opening it displays a right-side panel or full-height drawer so the workflow canvas remains visible. Selecting a finding focuses and highlights its node or edge.

### Report header

The report shows:

- Workflow name and selected clinic
- Draft or published status
- Whether the report used saved or unsaved editor content
- Diagnostic start and completion times
- Overall status: **Ready**, **Needs attention**, or **Not ready**
- A reminder that readiness is diagnostic evidence, not proof of future provider delivery

### Workflow check

The first section runs the existing detailed validator and related reference checks. It covers:

- Missing trigger, multiple triggers, unreachable nodes, invalid ports, unsafe loops, and missing endings
- Missing required node configuration or routing outcomes
- Invalid references to workflows, nodes, doctors, services, templates, or required variables
- Booking data-flow requirements such as doctor, service, slot, and patient-detail capture
- AI Agent route targets and required fallback/error paths

Each finding contains a stable code, severity, title, affected node or edge, plain-language explanation, remediation, and optional technical detail. **Go to step** navigates to the relevant canvas element.

### Safe test

The second section calls the existing deterministic workflow simulator with synthetic inputs. It supports representative scenarios already modeled by the simulator:

- Normal success path
- Provider failure
- Empty/no-availability result
- Intent-confidence outcomes
- AI Agent reply, handoff, no-match, routed, and error outcomes
- Step and resume behavior for patient-reply boundaries

The UI labels all effects as mocked. The simulator must never invoke a provider, persist a patient or appointment record, send a message, or queue background work.

### Integration readiness

The third section reports read-only readiness for dependencies referenced by the graph:

- WhatsApp channel connection and required configuration
- Google Calendar connection and doctor/calendar mapping
- AI provider enablement, selected model configuration, and known credential health
- Clinic KB availability and indexing/readiness state
- Referenced doctors, services, workflows, and templates

Checks may use current stored readiness and safe provider metadata/health operations where an established non-mutating mechanism exists. Each check has an independent timeout and returns **Ready**, **Warning**, **Failed**, or **Unknown**, plus the last verification time. Secret values and raw provider responses are never returned.

### Recent runs

The fourth section reuses existing redacted workflow-run endpoints. It shows recent status, duration, last completed step, failure category, and safe trace summary. It does not expose patient messages, identifiers, provider payloads, or internal secrets.

## Authorization and clinic isolation

UI hiding is convenience only. The diagnostic endpoint must require `ia_studio_admin` before resolving repositories or performing readiness checks. Requests from anonymous users, clinic administrators, secretaries, doctors, and other roles return `403 Forbidden`.

The endpoint resolves the clinic with the established clinic-scope mechanism and loads the workflow using both clinic ID and workflow ID. The submitted graph may replace the saved nodes and edges for this diagnostic request only; it is never persisted.

## API design

Add one cohesive endpoint under the existing workflow route:

`POST /clinics/:id/workflows/:workflowId/diagnostics`

Request:

```json
{
  "graph": { "nodes": [], "edges": [] },
  "simulation": {
    "enabled": true,
    "scenarios": []
  },
  "readiness": {
    "enabled": true,
    "refresh": false
  },
  "recentRunsLimit": 10
}
```

The graph is optional and uses the saved workflow when omitted. Schema limits must match or be stricter than the existing simulation endpoint. `recentRunsLimit` is clamped to the existing safe run-history bounds.

Response:

```json
{
  "diagnostic": {
    "status": "ready",
    "source": "unsaved_graph",
    "startedAt": "...",
    "completedAt": "...",
    "workflowChecks": [],
    "simulations": [],
    "integrations": [],
    "recentRuns": []
  }
}
```

The endpoint is an orchestration layer. It must call existing validator, simulator, readiness, and redaction functions rather than reimplement their rules.

## Status calculation

- **Not ready:** one or more blocking graph errors, simulation failures on required paths, or required integration failures.
- **Needs attention:** warnings, unknown readiness, stale health evidence, or failures limited to optional paths.
- **Ready:** no blocking or warning findings in the requested checks.

Status calculation is deterministic and returned with the individual evidence that produced it. A timeout is reported as **Unknown**, not silently treated as success.

## Error handling

- Authentication or authorization failure stops before data access.
- Invalid request shape returns structured validation errors.
- Missing clinic or workflow returns the established not-found or forbidden response without cross-clinic disclosure.
- Graph validation failure is included in the report and prevents simulation, but integration and recent-run checks may still complete.
- Integration failures and timeouts are isolated per dependency.
- Unexpected server errors use safe correlation IDs and never include secrets or raw patient/provider content.

## Audit and data handling

Record the actor ID, clinic ID, workflow ID, diagnostic source, requested sections, overall result counts, and timestamps using the existing audit repository. Do not record graph configuration values, simulation messages, patient data, credentials, or raw provider responses in the audit event.

Diagnostic responses are returned to the requesting superuser and are not persisted as a second workflow-run history. Existing redacted workflow-run records remain the source of truth for runtime evidence.

## Test strategy

### API

- Anonymous and every non-superuser role receive `403` before repository access.
- Superuser clinic resolution and cross-clinic isolation.
- Saved and unsaved graph sources.
- Structured validator findings and simulation suppression on invalid graphs.
- Independent integration timeout/failure handling.
- Redaction of secrets, patient content, and provider payloads.
- Audit event contains metadata only.

### Agent/workflow package

- Reuse existing validator and simulator suites.
- Add only focused tests needed for diagnostic aggregation and deterministic status calculation.
- Prove all simulation executors remain mocked and side-effect free.

### InboxOS

- Button and panel render only for `ia_studio_admin`.
- A new, never-saved workflow explains that the draft must be saved once before diagnosis.
- Loading, empty, partial, error, and completed states.
- Overall status and section status rendering.
- **Go to step** focuses the correct node or edge.
- Unsaved graph indicator and diagnostic request payload.
- Keyboard access and appropriate dialog/drawer semantics.

## Release boundaries

Source completion, automated checks, deployed build identity, integration readiness, live workflow evidence, execution completion, and owner acceptance must be reported separately. The feature must not be described as proof that WhatsApp, Google Calendar, or an AI provider will complete a future patient interaction.
