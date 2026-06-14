# WhatsApp integration

Docmee should connect to the WhatsApp Business API through an inbound webhook and an outbound sender.

## Inbound flow

1. Verify setup challenge.
2. Check request authenticity.
3. Normalize the provider payload.
4. Resolve the clinic tenant.
5. Store a normalized message record.
6. Queue conversation processing.

## Outbound flow

1. Build response from an approved flow.
2. Check the response against safety policy.
3. Store an outbound message attempt.
4. Send through the provider API.
5. Update delivery status from provider callbacks.

## MVP message types

- Text message
- Menu-style prompts where supported
- Staff handoff notice

## Configuration

Each deployment should configure phone number metadata, webhook verification value, and provider access secret through environment variables or a secret manager.

## Failure handling

- Retry transient provider errors.
- Mark permanent failures clearly.
- Do not silently drop inbound messages.
- Show failed sends in staff-facing logs.
