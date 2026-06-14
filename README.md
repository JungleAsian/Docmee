# Docmee

Clean-slate rebuild of a multi-tenant, self-hosted AI chatbot platform for clinics in Guatemala, delivered through the WhatsApp Business API.

The earlier prototype remains archived in `Docmee-Alpha`; this repo should stay clean, auditable, and phase-driven.

## Product goals

- Help clinics manage patient conversations through WhatsApp.
- Support multiple clinics as isolated tenants.
- Provide appointment, FAQ, intake, and staff handoff flows.
- Keep sensitive data protected by default.
- Make deployment self-hostable and inspectable.

## Current status

This is a foundation commit. It adds documentation, architecture notes, security policy, CI, and a small placeholder TypeScript package so the repository has a clean baseline before product code is added.

## Safety boundaries

Docmee is not a replacement for doctors, emergency services, or licensed clinical judgment. The platform should route urgent, uncertain, or high-risk conversations to clinic staff or emergency guidance rather than giving definitive clinical advice.

## Repository structure

```text
src/                  placeholder application entrypoint
test/                 baseline tests
docs/                 product, architecture, security, and build docs
.github/workflows/    CI
```

## Local development

```bash
npm install
npm test
npm run build
```

## Documentation

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY_MODEL.md)
- [Data model](docs/DATA_MODEL.md)
- [WhatsApp integration](docs/WHATSAPP_INTEGRATION.md)
- [AI safety policy](docs/AI_SAFETY.md)
- [Roadmap](docs/ROADMAP.md)
- [Security policy](SECURITY.md)

## Clean-room note

This repository is a fresh implementation. Do not copy code, secrets, credentials, sensitive records, or private configuration from any previous prototype.
