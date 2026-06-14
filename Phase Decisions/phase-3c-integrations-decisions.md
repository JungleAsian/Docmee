# Docmee — Phase 3C (Integrations, OCR & Reports): Locked Decisions & Acceptance Gate

**Status:** 🔒 SEALED · **Date:** 13 June 2026
**Companion docs:** prior phase records · `docmee-trackers.xlsx`

Phase 3C adds OCR/rich-format document ingestion, outbound Sheets/CRM export, and automated reports.

---

## Scope
**In:** OCR + docx/structured document ingestion; Google Sheets / CRM export; automated periodic reports.
**Out (deferred):** none specific to 3C.

## Decisions

**Q1 — OCR & rich-format ingestion (8.5).** Extend the 1A text-layer ingestion pipeline with a provider-abstracted OCR stage (scanned PDFs/images) plus docx/structured parsers (tables, service lists, doctor profiles). Same chunk → embed → KB path; low-confidence OCR is flagged for human review before entering the KB; per-clinic. Resolves the advanced half of PR25.

**Q2 — Google Sheets / CRM export (8.0).** An outbound integration layer — Google Sheets append + a generic webhook/CRM connector (configurable per clinic), triggered on events (new lead, appointment scheduled) or scheduled batches; per-clinic field mapping; clinic-authorized fields only. *Lower confidence: PHI egress to external systems is a real concern — mitigated by clinic-authorization, encrypted creds, and audit (SEC24).*

**Q3 — Automated reports (8.5).** A reporting scheduler renders the 2D analytics into periodic reports (PDF/email/Sheet) on a per-clinic cadence; reuses analytics rollups + the email channel; clinic-scoped aggregates.

## Sweep locks
- **G47 OCR confidence/review:** low-confidence OCR flagged for human review before entering the KB; never silently ingest garbage.
- **G48 External-export PHI safety & consent:** only clinic-authorized fields exported; per-clinic config; egress audited + revocable; logged (SEC24).
- **G49 Integration credential security:** Sheets/CRM OAuth tokens stored encrypted like Meta/Calendar tokens; rotation; per-clinic isolation.
- **G50 Export/report idempotency & retries:** no duplicate rows/reports on retry; bounded retry; failures surfaced in the error-review area.
- **G51 Report PHI scoping:** reports contain clinic-scoped data only; aggregates where possible; access-controlled delivery.

## Acceptance gate
1. Ingestion handles scanned docs via OCR + docx/structured parsers; low-confidence flagged for review; same KB path.
2. Per-clinic Sheets/CRM export (append + webhook); encrypted creds; clinic-authorized fields only; egress audited.
3. Automated periodic reports (PDF/email/Sheet) from 2D analytics; per-clinic cadence; clinic-scoped.

## Tracker cross-references
- Decisions: 3C OCR ingestion · Sheets/CRM export · Automated reports.
- Actions: X18 (per-clinic Sheets/CRM connect).
- Security: SEC24 (external data egress — mitigated by clinic-authorization + audit).
- Requirements: PR25 (Covered — OCR added), PR31 (Sheets/CRM — Planned → 3C).
- Gaps: G47–G51.

---
