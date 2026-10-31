-- Simulator testers mark each LAYA pick Correct or Wrong: label_source 'tester_review'.
-- Only widens the allowed values; existing rows are untouched.
ALTER TABLE laya_observations DROP CONSTRAINT IF EXISTS laya_observations_label_source_check;
ALTER TABLE laya_observations ADD CONSTRAINT laya_observations_label_source_check
  CHECK (label_source IS NULL OR label_source IN ('next_tap', 'ai_scenario', 'readback_yes', 'tester_review'));
