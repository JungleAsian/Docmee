-- P02: Shared database functions

-- Auto-update updated_at on any table that has this trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Convenience: attach set_updated_at trigger to any table
CREATE OR REPLACE FUNCTION add_updated_at_trigger(target_table TEXT)
RETURNS VOID AS $$
BEGIN
  EXECUTE format(
    'DROP TRIGGER IF EXISTS trg_set_updated_at ON %I;
     CREATE TRIGGER trg_set_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
    target_table, target_table
  );
END;
$$ LANGUAGE plpgsql;

-- Audit helper: insert a row into audit_events from any trigger context
-- Usage: PERFORM log_audit_event(clinic_id, actor_id, action, resource_type, resource_id, metadata);
CREATE OR REPLACE FUNCTION log_audit_event(
  p_clinic_id     UUID,
  p_actor_id      UUID,
  p_action        TEXT,
  p_resource_type TEXT,
  p_resource_id   UUID DEFAULT NULL,
  p_metadata      JSONB DEFAULT '{}'
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO audit_events (clinic_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (p_clinic_id, p_actor_id, p_action, p_resource_type, p_resource_id, p_metadata);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
