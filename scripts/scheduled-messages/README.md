# Isolated scheduled-message SQL checks

These checks use the actual scheduled-message migration and repository against
minimal synthetic dependencies. They do not exercise the full migration chain,
Redis, WhatsApp, or the browser, and are not authorization to enable delivery.

## Prerequisites and safety

- Use a disposable **local PostgreSQL 14+** server, not a tunnel or proxy to any
  shared/production server. The database must be named `docmee_scheduled_test`
  or `docmee_scheduled_test_<lowercase-alphanumeric-suffix>`.
- Provision that separate test database beforehand. The test user needs schema
  creation, `CREATEROLE`, and permission to assume the generated restricted role.
  Use only local test credentials; do not reuse Docmee application credentials.
- The guard rejects remote hosts, other database names, URL query overrides, and
  missing explicit opt-in. It never uses `DATABASE_URL` as a fallback. A localhost
  address alone cannot prove that the server is disposable: verify the server
  identity yourself before running.
- Each run creates a randomly named schema and NOLOGIN, non-superuser,
  non-BYPASSRLS role. Cleanup drops only that run's schema and role. It never
  drops a database or touches an existing application schema. An interrupted
  process can leave its generated fixtures behind; inspect exact names before
  manually removing them.
- No provider is initialized; recipients and messages are synthetic.

## Commands

Run from the repository root. In a private terminal set
`DOCMEE_SCHEDULED_TEST_DATABASE_URL` to the disposable local test database URL;
do not paste credentials into chat or check them into source.

```powershell
$env:DOCMEE_SCHEDULED_INTEGRATION = 'true'
.\node_modules\.bin\vitest.cmd run --config scripts/scheduled-messages/vitest.integration.config.ts
```

Unset both test variables after the run. Do not change worker/clinic flags.

The isolation guard can be tested without a database:

```powershell
.\node_modules\.bin\vitest.cmd run scripts/scheduled-messages/integration-target.test.ts
.\node_modules\.bin\tsc.cmd -p scripts/scheduled-messages/tsconfig.json
```

## SQL coverage (must be executed before claiming a pass)

1. Concurrent same-key create returns one durable row.
2. Concurrent due claims have one winner.
3. Claim/edit/cancel compete under version checks.
4. Future, cancelled, obsolete-version and cross-clinic claims fail.
5. Restricted-role RLS protects reads and writes.
6. Stale attempts become uncertain; one late confirmation preserves a closed chat.
7. Audit persistence failure rolls back sent state and timeline.
8. Confirmation merges current open-chat metadata and does not duplicate a send.
9. Inbound evidence is bound to clinic, recipient and WhatsApp account.

Record results and remaining queue/browser/pilot gates in the existing
[verification record](../../docs/superpowers/plans/2026-10-07-scheduled-messages-verification.md).
