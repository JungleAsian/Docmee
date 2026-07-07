-- Req 3 (WhatsApp delivery status): index for matching a Meta `statuses` receipt
-- back to the outbound message it refers to.
--
-- Meta posts delivery receipts (sent → delivered → read, or failed) keyed by the
-- outbound message id (the wamid we stored as conversation_messages.channel_message_id
-- when the reply was sent). The delivery-status worker looks the message up by
-- (clinic_id, channel_message_id) on every receipt; without an index that is a
-- table scan per receipt. channel_message_id is NOT unique (an inbound user message
-- and an outbound reply each carry their own wamid), so this is a plain b-tree, not
-- a unique constraint. The partial predicate skips the many rows that never carry a
-- wamid (system/agent notes), keeping the index small.
CREATE INDEX IF NOT EXISTS idx_messages_channel_message_id
  ON conversation_messages (clinic_id, channel_message_id)
  WHERE channel_message_id IS NOT NULL;
