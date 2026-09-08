-- Sensitive transient data retention.
--
-- Raw provider payloads, AI retrieval traces, outbound notification payloads,
-- and diagnostic stack/context rows are treated as sensitive transient data.
-- The worker enforces the 24-hour purge window; these indexes keep that sweep
-- cheap as production volume grows.

CREATE INDEX IF NOT EXISTS idx_webhook_events_sensitive_ttl
  ON webhook_events(created_at);

CREATE INDEX IF NOT EXISTS idx_knowledge_retrieval_events_sensitive_ttl
  ON knowledge_retrieval_events(created_at);

CREATE INDEX IF NOT EXISTS idx_notification_events_sensitive_ttl
  ON notification_events(created_at);

CREATE INDEX IF NOT EXISTS idx_error_reviews_sensitive_ttl
  ON error_reviews(created_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_sensitive_metadata_ttl
  ON ai_usage_events(created_at)
  WHERE metadata <> '{}'::jsonb;

COMMENT ON TABLE webhook_events IS
  'Raw provider webhook payloads are sensitive transient data and are purged after 24 hours by the worker.';

COMMENT ON TABLE knowledge_retrieval_events IS
  'AI retrieval telemetry is sensitive transient data and is purged after 24 hours by the worker.';

COMMENT ON TABLE notification_events IS
  'Outbound notification payloads are sensitive transient data and are purged after 24 hours by the worker.';

COMMENT ON TABLE error_reviews IS
  'Error stack traces and context are sensitive transient data and are purged after 24 hours by the worker.';

COMMENT ON TABLE ai_usage_events IS
  'AI usage accounting is retained for analytics; sensitive metadata is scrubbed after 24 hours by the worker.';
