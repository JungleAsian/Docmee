-- Permit repository PDF sends to be represented truthfully in conversation history.
ALTER TABLE conversation_messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE conversation_messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN ('text', 'audio', 'image', 'document', 'template', 'interactive'));
