import type { Migration } from "../runner.js";

/**
 * 009 — Analytics & error review (Phase 2D). Aggregate metrics hold COUNTS ONLY —
 * no raw PHI (G33, ties SEC16). Error review extends error_log with category +
 * status, and unanswered/unknown items become KB-entry suggestions (G35).
 *
 * NOTE: per-clinic full-text message search (Q3) is intentionally NOT included —
 * it conflicts with the ciphertext-only encryption of message bodies and awaits
 * a product decision.
 */
const sql = /* sql */ `
  CREATE TABLE clinic_metrics (
    clinic_id  uuid NOT NULL REFERENCES clinics(id),
    day        date NOT NULL,
    metric_key text NOT NULL,
    value      bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (clinic_id, day, metric_key)
  );

  ALTER TABLE error_log ADD COLUMN category    text;
  ALTER TABLE error_log ADD COLUMN status      text NOT NULL DEFAULT 'open'
                                   CHECK (status IN ('open','resolved','kb_suggested'));
  ALTER TABLE error_log ADD COLUMN resolved_at timestamptz;

  CREATE TABLE kb_improvement_suggestions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id  uuid NOT NULL REFERENCES clinics(id),
    question   text NOT NULL,
    source     text,
    status     text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','accepted','dismissed')),
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX clinic_metrics_day ON clinic_metrics (clinic_id, day);
  CREATE INDEX error_log_review ON error_log (clinic_id, status, created_at DESC);

  ALTER TABLE clinic_metrics ENABLE ROW LEVEL SECURITY;
  ALTER TABLE kb_improvement_suggestions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE clinic_metrics FORCE ROW LEVEL SECURITY;
  ALTER TABLE kb_improvement_suggestions FORCE ROW LEVEL SECURITY;

  CREATE POLICY clinic_scope ON clinic_metrics
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON kb_improvement_suggestions
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());

  GRANT SELECT, INSERT, UPDATE ON clinic_metrics, kb_improvement_suggestions TO docmee_app;
`;

const migration: Migration = { version: 9, name: "analytics", sql };
export default migration;
