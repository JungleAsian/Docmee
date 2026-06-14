# Data model

This is the initial conceptual data model. It is not a final database schema.

## Tenant

Represents one clinic or clinic group.

Fields:

- id
- name
- country
- timezone
- status
- created_at
- updated_at

## Staff user

Represents a clinic staff account.

Fields:

- id
- tenant_id
- email
- name
- role
- status
- created_at
- updated_at

## WhatsApp channel

Represents a connected WhatsApp Business number.

Fields:

- id
- tenant_id
- phone_number_id
- display_phone_number
- webhook_status
- created_at
- updated_at

## Patient contact

Represents a WhatsApp contact interacting with a clinic.

Fields:

- id
- tenant_id
- whatsapp_user_id
- display_name
- consent_status
- created_at
- updated_at

## Conversation

Represents a message thread.

Fields:

- id
- tenant_id
- patient_contact_id
- status
- assigned_staff_user_id
- last_message_at
- created_at
- updated_at

## Message

Represents inbound or outbound messages.

Fields:

- id
- tenant_id
- conversation_id
- direction
- sender_type
- body
- provider_message_id
- status
- created_at

## Knowledge item

Approved clinic knowledge used for answers.

Fields:

- id
- tenant_id
- title
- body
- category
- status
- reviewed_by
- reviewed_at
- created_at
- updated_at

## Handoff

Represents a conversation requiring staff attention.

Fields:

- id
- tenant_id
- conversation_id
- reason
- priority
- status
- assigned_staff_user_id
- created_at
- resolved_at

## Audit log

Records important operational events.

Fields:

- id
- tenant_id
- actor_type
- actor_id
- action
- target_type
- target_id
- metadata
- created_at
