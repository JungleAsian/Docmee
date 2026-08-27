# Docmee 18-item production verification and fixes

## Objective contract

Objective: Finish and verify the requested 18-item Docmee inbox, calendar, workflow, and repository update for clinic secretaries on the existing AWS application.

Scope: Audit the production implementation at `8738ef17244de1f916782d900a734cd40e1a2633`; repair release-blocking gaps; preserve existing patient data and application architecture; publish reviewed commits; deploy through the existing AWS runtime; verify the public build fingerprint and smoke checks.

Non-goals: No replacement application, no destructive migration, no production workflow-record rewrite, no real patient/customer message, no Google Drive integration, and no claim of provider delivery or human acceptance without direct evidence.

Constraints and dependencies: Additive schema changes only; clinic feature flags and rollback must remain available; human-only mode must be enforced at backend trust boundaries; booking concurrency must remain database-authoritative; existing user changes in the original checkout must not be modified; AWS access must be authenticated before cutover.

Acceptance evidence: Clean install; preflight; typecheck; lint; full tests; production build; migration review/test; requirement trace for all 18 items; secret scan and staged-diff review; fresh-context release review; GitHub commit/ref; AWS deployed commit/build ID; service and public regression checks. Provider delivery and unaided human UX remain separately labeled when not exercised.

Gates and decision owner: The user authorized implementation, source publication, and deployment in this task. Credential access must use existing managed authentication. Real patient messages and destructive data changes remain unapproved.

Stop condition: Complete when all available acceptance evidence passes and the existing AWS application reports the published build; blocked only if a required external credential/session cannot be restored after safe alternatives are exhausted.

## Global constraints

- Preserve the existing modular monorepo and AWS application.
- Do not send real patient/customer messages or create real appointments for testing.
- Keep human-only mode separate from STOP/START consent and enforce it before every automated send/resume path.
- Keep booking overlap counting transactional and database-authoritative.
- Keep media private, clinic-scoped, signature-validated, quota-limited, and soft-deletable.
- Keep migrations additive and rollback available through feature flags and the prior deployed commit.
- Distinguish code, tests, GitHub, AWS deployment, provider delivery, and human acceptance.

## Tasks

1. Repair clean-checkout release gates so the production candidate passes the same typecheck and test commands used by CI.
2. Trace every requested item to code, schema, tests, and reachable UI; implement only confirmed gaps and add focused regression coverage first.
3. Run full release verification, independent review, secret scan, publish the reviewed commit, deploy it to the existing AWS host, run additive migrations and regression checks, and verify the public build fingerprint.
