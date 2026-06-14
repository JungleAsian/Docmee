# Security policy

## Reporting

Do not open public issues for vulnerabilities or exposed secrets. Contact the repository owner privately and include reproduction steps, affected files, and suggested impact.

## Sensitive data

Do not commit:

- Provider tokens
- Database credentials
- Session secrets
- Production records
- Private clinic configuration
- Raw conversation exports

## Development rules

- Keep secrets in environment variables or a secret manager.
- Use placeholder values in examples.
- Redact sensitive values from logs.
- Review migrations for tenant isolation.
- Review new outbound integrations before enabling them in production.

## Dependency posture

This foundation starts with minimal dependencies. Add dependencies only when they are necessary and maintained.

## Pre-release checklist

```bash
npm install --ignore-scripts
npm test
npm run build
npm audit
```
