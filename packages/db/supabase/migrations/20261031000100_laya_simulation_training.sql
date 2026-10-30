-- LAYA training examples from the Automation Center workflow simulator.
-- source 'simulation': text typed by clinic staff in the simulator (no patient, no conversation).
--   These rows are kept out of the patient measurement summary and may be exported for training.
-- label_source 'readback_yes': the person confirmed LAYA's pick with a clear YES at the read-back check.
-- Additive only: existing rows and values stay valid.
ALTER TABLE laya_observations DROP CONSTRAINT IF EXISTS laya_observations_source_check;
ALTER TABLE laya_observations ADD CONSTRAINT laya_observations_source_check
  CHECK (source IN ('menu_trigger', 'menu_unmatched', 'ai_agent', 'simulation'));

ALTER TABLE laya_observations DROP CONSTRAINT IF EXISTS laya_observations_label_source_check;
ALTER TABLE laya_observations ADD CONSTRAINT laya_observations_label_source_check
  CHECK (label_source IS NULL OR label_source IN ('next_tap', 'ai_scenario', 'readback_yes'));

CREATE INDEX IF NOT EXISTS idx_laya_observations_training
  ON laya_observations (clinic_id, source, labeled_at DESC)
  WHERE label_choice_id IS NOT NULL;
