-- P02: Row Level Security policies
--
-- Strategy:
--   - Enable RLS on all clinic-scoped tables.
--   - Policies read app.clinic_id session variable (set per-transaction by the app layer).
--   - Service role (BYPASSRLS) skips all policies — used for migrations, seeds, and admin ops.
--   - The app layer ALSO enforces clinic_id in WHERE clauses (defence in depth).
--
-- To set clinic context before a query:
--   BEGIN;
--   SELECT set_config('app.clinic_id', '<uuid>', true); -- true = local to transaction
--   -- run queries
--   COMMIT;

-- Helper to get current clinic_id from session (returns NULL if not set)
CREATE OR REPLACE FUNCTION app_clinic_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.clinic_id', true), '')::UUID;
$$ LANGUAGE SQL STABLE;

-- ── Tenant tables ──────────────────────────────────────────────────────────────

ALTER TABLE clinics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_users  ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinic_isolation         ON clinics;
DROP POLICY IF EXISTS clinic_users_isolation   ON clinic_users;
DROP POLICY IF EXISTS roles_isolation          ON roles;
DROP POLICY IF EXISTS user_roles_isolation     ON user_roles;
DROP POLICY IF EXISTS audit_events_isolation   ON audit_events;

CREATE POLICY clinic_isolation         ON clinics       FOR ALL USING (id          = app_clinic_id());
CREATE POLICY clinic_users_isolation   ON clinic_users  FOR ALL USING (clinic_id   = app_clinic_id());
CREATE POLICY roles_isolation          ON roles         FOR ALL USING (clinic_id   = app_clinic_id() OR clinic_id IS NULL);
CREATE POLICY user_roles_isolation     ON user_roles    FOR ALL USING (
  EXISTS (SELECT 1 FROM clinic_users cu WHERE cu.id = clinic_user_id AND cu.clinic_id = app_clinic_id())
);
CREATE POLICY audit_events_isolation   ON audit_events  FOR ALL USING (clinic_id   = app_clinic_id());

-- ── Patient and conversation tables ───────────────────────────────────────────

ALTER TABLE patients               ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_contacts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_tags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_tag_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_notes         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patients_isolation               ON patients;
DROP POLICY IF EXISTS patient_contacts_isolation       ON patient_contacts;
DROP POLICY IF EXISTS conversations_isolation          ON conversations;
DROP POLICY IF EXISTS conversation_messages_isolation  ON conversation_messages;
DROP POLICY IF EXISTS conversation_tags_isolation      ON conversation_tags;
DROP POLICY IF EXISTS conversation_tag_links_isolation ON conversation_tag_links;
DROP POLICY IF EXISTS internal_notes_isolation         ON internal_notes;

CREATE POLICY patients_isolation               ON patients               FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY patient_contacts_isolation       ON patient_contacts       FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY conversations_isolation          ON conversations          FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY conversation_messages_isolation  ON conversation_messages  FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY conversation_tags_isolation      ON conversation_tags      FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY conversation_tag_links_isolation ON conversation_tag_links FOR ALL USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND c.clinic_id = app_clinic_id())
);
CREATE POLICY internal_notes_isolation         ON internal_notes         FOR ALL USING (clinic_id = app_clinic_id());

-- ── Channel tables ─────────────────────────────────────────────────────────────

ALTER TABLE channel_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_delivery_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channel_accounts_isolation        ON channel_accounts;
DROP POLICY IF EXISTS message_delivery_events_isolation ON message_delivery_events;

CREATE POLICY channel_accounts_isolation        ON channel_accounts        FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY message_delivery_events_isolation ON message_delivery_events FOR ALL USING (clinic_id = app_clinic_id());

-- webhook_events: not RLS-isolated — processed by inbound webhook handler before clinic is known
-- (clinic_id may be NULL on arrival)

-- ── Appointment tables ─────────────────────────────────────────────────────────

ALTER TABLE services              ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_events    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS services_isolation              ON services;
DROP POLICY IF EXISTS providers_isolation             ON providers;
DROP POLICY IF EXISTS provider_availability_isolation ON provider_availability;
DROP POLICY IF EXISTS appointments_isolation          ON appointments;
DROP POLICY IF EXISTS appointment_events_isolation    ON appointment_events;

CREATE POLICY services_isolation              ON services              FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY providers_isolation             ON providers             FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY provider_availability_isolation ON provider_availability FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY appointments_isolation          ON appointments          FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY appointment_events_isolation    ON appointment_events    FOR ALL USING (clinic_id = app_clinic_id());

-- ── Knowledge and IA tables ────────────────────────────────────────────────────

ALTER TABLE ia_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_events    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ia_profiles_isolation         ON ia_profiles;
DROP POLICY IF EXISTS ia_rules_isolation            ON ia_rules;
DROP POLICY IF EXISTS knowledge_documents_isolation ON knowledge_documents;
DROP POLICY IF EXISTS knowledge_chunks_isolation    ON knowledge_chunks;
DROP POLICY IF EXISTS ai_usage_events_isolation     ON ai_usage_events;

CREATE POLICY ia_profiles_isolation         ON ia_profiles         FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY ia_rules_isolation            ON ia_rules            FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY knowledge_documents_isolation ON knowledge_documents  FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY knowledge_chunks_isolation    ON knowledge_chunks     FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY ai_usage_events_isolation     ON ai_usage_events      FOR ALL USING (clinic_id = app_clinic_id());

-- ── Operations tables ──────────────────────────────────────────────────────────

ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_events_isolation ON notification_events;
DROP POLICY IF EXISTS error_reviews_isolation       ON error_reviews;
DROP POLICY IF EXISTS feature_flags_isolation       ON feature_flags;

CREATE POLICY notification_events_isolation ON notification_events FOR ALL USING (clinic_id = app_clinic_id() OR clinic_id IS NULL);
CREATE POLICY error_reviews_isolation       ON error_reviews       FOR ALL USING (clinic_id = app_clinic_id() OR clinic_id IS NULL);
CREATE POLICY feature_flags_isolation       ON feature_flags       FOR ALL USING (clinic_id = app_clinic_id() OR clinic_id IS NULL);

-- dev_seed_runs and _migrations are admin-only, no RLS
