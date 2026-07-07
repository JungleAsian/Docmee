-- CRE-53: idempotent inbound message ingestion.
-- Meta redelivers webhooks aggressively; without this a retry inserts a duplicate
-- conversation message (and used to re-enqueue the agent → duplicate AI reply).
-- A partial unique index makes (clinic_id, channel_message_id) unique for any row
-- that carries a channel message id, so the repository's ON CONFLICT DO NOTHING
-- makes create() idempotent. (Queue-level jobId dedup guards the agent reply.)
CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_channel_msg_uniq
  ON conversation_messages (clinic_id, channel_message_id)
  WHERE channel_message_id IS NOT NULL;
