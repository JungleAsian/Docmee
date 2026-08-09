// Typed interfaces for all P02 database tables.
// Column names are camelCase (postgres.js camel transform applied on read).
// Generated types (via supabase gen types) can replace this file in future phases.

// ── Shared ────────────────────────────────────────────────────────────────────

export type ClinicPlan   = 'starter' | 'pro' | 'enterprise'
export type ClinicStatus = 'active' | 'suspended' | 'cancelled'
export type Channel      = 'whatsapp' | 'messenger' | 'instagram'

// ── Tenant ────────────────────────────────────────────────────────────────────

export interface Clinic {
  id: string
  name: string
  slug: string
  plan: ClinicPlan
  status: ClinicStatus
  settings: Record<string, unknown>
  timezone: string
  // Profile info surfaced to patients via the bot (address/location, contact
  // phone, and a free-text clinic type/specialty like "Dental" or "Pediatric").
  address: string | null
  phone: string | null
  clinicType: string | null
  // P14 — Facebook Messenger connection (one Page per clinic).
  messengerPageId: string | null
  messengerPageAccessTokenEncrypted: string | null
  messengerWebhookVerifyToken: string | null
  messengerEnabled: boolean
  // P15 — Instagram Direct connection (one Instagram account per clinic).
  instagramAccountId: string | null
  instagramPageAccessTokenEncrypted: string | null
  instagramWebhookVerifyToken: string | null
  instagramEnabled: boolean
  createdAt: string
  updatedAt: string
}

export type ClinicUserStatus = 'active' | 'inactive' | 'invited'

export interface ClinicUser {
  id: string
  clinicId: string
  userId: string
  email: string
  fullName: string | null
  status: ClinicUserStatus
  lastSeen: string | null
  passwordHash: string | null
  panelLanguage: PanelLanguage
  inactivityTimeoutMinutes: number
  notificationPrefs: NotificationPrefsRow
  createdAt: string
  updatedAt: string
}

/** A clinic user with their resolved highest-privilege panel role (Req 1 — user management). */
export interface ClinicUserWithRole extends ClinicUser {
  role: PanelRole
}

export type PanelLanguage = 'es' | 'en'

/**
 * Per-user notification preferences (Req 24), stored in
 * clinic_users.notification_prefs. Free-form JSON; the notifications package owns
 * the normalized shape ({ emailEnabled, mutedTypes }). Gates the EMAIL channel
 * only — the bell feed always records every alert, and p1 alerts always email.
 */
export type NotificationPrefsRow = Record<string, unknown>

/** The four panel roles, derived from the user's highest-privilege role name. */
export type PanelRole = 'secretary' | 'doctor' | 'clinic_admin' | 'ia_studio_admin'
export type MembershipStatus = 'active' | 'suspended'
export type PermissionKey =
  | 'inbox.view'
  | 'inbox.assign'
  | 'appointments.manage'
  | 'calendar.view'
  | 'patients.manage'
  | 'analytics.view'
  | 'admin.users.manage'
  | 'admin.clinic.configure'
  | 'platform.clinics.manage'

/** Credentials + resolved role for a clinic user, returned by login lookup. */
export interface ClinicUserAuth {
  id: string
  accountUserId: string
  clinicId: string
  email: string
  fullName: string | null
  status: ClinicUserStatus
  passwordHash: string | null
  panelLanguage: PanelLanguage
  inactivityTimeoutMinutes: number
  role: PanelRole
  permissions: PermissionKey[]
  accessibleClinicIds: string[]
  isGlobalSuperAdmin: boolean
}

export interface Role {
  id: string
  clinicId: string | null
  name: string
  description: string | null
  isSystem: boolean
  createdAt: string
  updatedAt: string
}

export interface Permission {
  id: string
  key: PermissionKey
  name: string
  category: string | null
  description: string | null
  createdAt: string
}

export interface RolePermission {
  id: string
  roleId: string
  permissionId: string
  createdAt: string
}

export interface UserRole {
  id: string
  clinicUserId: string
  roleId: string
  createdAt: string
}

export interface Membership {
  id: string
  userId: string
  clinicId: string | null
  roleId: string
  status: MembershipStatus
  createdAt: string
  updatedAt: string
}

export interface UserMenuOverride {
  userId: string
  clinicId: string
  menuKey: string
  hidden: boolean
  createdAt: string
  updatedAt: string
}

export interface AuditEvent {
  id: string
  clinicId: string
  actorId: string | null
  actorEmail: string | null
  action: string
  resourceType: string
  resourceId: string | null
  metadata: Record<string, unknown>
  ipAddress: string | null
  createdAt: string
}

// ── Patients ──────────────────────────────────────────────────────────────────

export type PatientStatus = 'new' | 'returning' | 'archived'

export interface Patient {
  id: string
  clinicId: string
  fullName: string | null
  status: PatientStatus
  notes: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface PatientContact {
  id: string
  patientId: string
  clinicId: string
  channel: Channel
  contactHandle: string
  isPrimary: boolean
  createdAt: string
  updatedAt: string
}

// Req 11: 7-state conversation lifecycle. The bot replies only while `open`
// (handoff.ts isBotPaused); every other status keeps it silent.
export type ConversationStatus =
  | 'open'
  | 'pending'
  | 'assigned'
  | 'handoff'
  | 'snoozed'
  | 'resolved'
  | 'archived'
export type ContentType        = 'text' | 'audio' | 'image' | 'template' | 'interactive'
export type MessageRole        = 'user' | 'assistant' | 'system' | 'agent'

export interface Conversation {
  id: string
  clinicId: string
  patientId: string | null
  channel: Channel
  channelContactHandle: string
  status: ConversationStatus
  assignedTo: string | null
  iaProfileId: string | null
  lastMessageAt: string | null
  snoozeUntil: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ConversationMessage {
  id: string
  conversationId: string
  clinicId: string
  role: MessageRole
  content: string
  contentType: ContentType
  channelMessageId: string | null
  audioUrl: string | null
  transcription: string | null
  tokenCount: number | null
  metadata: Record<string, unknown>
  createdAt: string
  /**
   * Latest delivery-lifecycle state for an outbound message (Req 3), derived from
   * the newest message_delivery_events row. null when no receipt exists yet (e.g.
   * an inbound `user` message, a Messenger/Instagram send, or a pre-feature send).
   * Only populated by listByConversation; absent on freshly created rows.
   */
  deliveryStatus?: DeliveryStatus | null
}

export interface ConversationTag {
  id: string
  clinicId: string
  name: string
  color: string
  createdAt: string
  updatedAt: string
}

export interface ConversationTagLink {
  id: string
  conversationId: string
  tagId: string
  createdAt: string
}

export interface InternalNote {
  id: string
  conversationId: string
  clinicId: string
  authorId: string
  content: string
  createdAt: string
  updatedAt: string
}

// ── Templates (P16) ─────────────────────────────────────────────────────────────

/** A canned secretary reply (Gap #25) inserted into the composer. */
export interface QuickReplyTemplate {
  id: string
  clinicId: string
  title: string
  content: string
  category: string
  createdAt: string
  updatedAt: string
}

export type MessageTemplateStatus   = 'pending' | 'approved' | 'rejected'
export type MessageTemplateCategory =
  | 'appointment_confirmation'
  | 'appointment_reminder'
  | 'human_handoff_notification'
  | 'review_request'

/** A WhatsApp/Meta message template (Gap #29). Submission to Meta is manual; the
 *  row only tracks the approval status the panel displays. */
export interface MessageTemplate {
  id: string
  clinicId: string
  name: string
  category: MessageTemplateCategory
  language: string
  body: string
  status: MessageTemplateStatus
  metaTemplateId: string | null
  metaStatus: string | null
  metaLastSyncedAt: string | null
  metaLastError: string | null
  createdAt: string
  updatedAt: string
}

// ── Channels ──────────────────────────────────────────────────────────────────

export type ChannelAccountStatus = 'active' | 'inactive' | 'error'
export type DeliveryStatus       = 'sent' | 'delivered' | 'read' | 'failed'

export interface ChannelAccount {
  id: string
  clinicId: string
  channel: Channel
  accountId: string
  displayName: string | null
  accessTokenEnc: string | null
  webhookVerifyToken: string | null
  status: ChannelAccountStatus
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface WebhookEvent {
  id: string
  clinicId: string | null
  channel: string
  eventType: string
  payload: Record<string, unknown>
  processed: boolean
  processedAt: string | null
  error: string | null
  createdAt: string
}

export interface MessageDeliveryEvent {
  id: string
  messageId: string
  clinicId: string
  channelMessageId: string | null
  status: DeliveryStatus
  error: string | null
  createdAt: string
}

// ── Appointments ──────────────────────────────────────────────────────────────

// Screen 2 — the appointment lifecycle. 'arrived' (patient checked in) and
// 'in_progress' (visit underway) sit between 'confirmed' and 'completed'.
export type AppointmentStatus =
  | 'pending' | 'confirmed' | 'arrived' | 'in_progress' | 'cancelled' | 'completed' | 'no_show'
export type AppointmentEventType =
  | 'created' | 'confirmed' | 'arrived' | 'in_progress' | 'cancelled' | 'rescheduled'
  | 'completed' | 'no_show' | 'reminder_sent'

export interface Service {
  id: string
  clinicId: string
  name: string
  description: string | null
  durationMinutes: number
  price: string | null
  currency: string
  isActive: boolean
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface Provider {
  id: string
  clinicId: string
  fullName: string
  email: string | null
  specialty: string | null
  googleCalendarId: string | null
  isActive: boolean
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** P18 (Gap #32) — a doctor with their own Google Calendar and weekly availability. */
export interface Doctor {
  id: string
  clinicId: string
  name: string
  specialty: string | null
  googleCalendarId: string | null
  /** Encrypted OAuth tokens for this doctor's calendar (null → use clinic calendar). */
  googleCalendarAccessTokenEncrypted: string | null
  googleCalendarRefreshTokenEncrypted: string | null
  /** Weekly availability, e.g. `{ "mon": ["09:00","17:00"], "tue": [...] }`. */
  availableDays: Record<string, unknown>
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ProviderAvailability {
  id: string
  providerId: string
  clinicId: string
  dayOfWeek: number
  startTime: string
  endTime: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface Appointment {
  id: string
  clinicId: string
  patientId: string
  /** Legacy provider booking. Null when booked under a P18 doctor instead. */
  providerId: string | null
  /** P18 (Gap #32) — the doctor this appointment is booked with. */
  doctorId: string | null
  serviceId: string | null
  conversationId: string | null
  googleEventId: string | null
  status: AppointmentStatus
  startTime: string
  endTime: string
  notes: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface AppointmentEvent {
  id: string
  appointmentId: string
  clinicId: string
  eventType: AppointmentEventType
  actorId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

// ── Knowledge and IA ──────────────────────────────────────────────────────────

export type DocumentType   = 'faq' | 'policy' | 'service_info' | 'custom'
export type DocumentStatus = 'active' | 'draft' | 'archived'
export type IaRuleType     = 'escalation' | 'topic_block' | 'greeting' | 'fallback' | 'hours' | 'keyword'

export interface IaProfile {
  id: string
  clinicId: string
  name: string
  systemPrompt: string
  model: string
  temperature: string
  maxTokens: number
  isActive: boolean
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface IaRule {
  id: string
  iaProfileId: string
  clinicId: string
  ruleType: IaRuleType
  condition: Record<string, unknown>
  action: Record<string, unknown>
  priority: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface KnowledgeDocument {
  id: string
  clinicId: string
  title: string
  content: string
  documentType: DocumentType
  status: DocumentStatus
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface KnowledgeChunk {
  id: string
  documentId: string
  clinicId: string
  content: string
  chunkIndex: number
  metadata: Record<string, unknown>
  createdAt: string
}

export interface AiUsageEvent {
  id: string
  clinicId: string
  iaProfileId: string | null
  conversationId: string | null
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

// ── Operations ────────────────────────────────────────────────────────────────

export type NotificationType   = 'email' | 'sms' | 'push' | 'in_app'
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'acknowledged'
export type ErrorReviewStatus  = 'open' | 'reviewed' | 'resolved' | 'ignored'
export type SeedRunStatus      = 'success' | 'failed' | 'partial'

export interface NotificationEvent {
  id: string
  clinicId: string | null
  notificationType: NotificationType
  recipient: string
  subject: string | null
  content: string
  status: NotificationStatus
  sentAt: string | null
  error: string | null
  conversationId: string | null
  alertType: string | null
  priority: string | null
  acknowledgedAt: string | null
  idempotencyKey?: string | null
  deliveryClaimedAt?: string | null
  deliveryClaimOwner?: string | null
  deliveryAttempts?: number
  metadata: Record<string, unknown>
  createdAt: string
}

export interface ErrorReview {
  id: string
  clinicId: string | null
  errorType: string
  errorMessage: string
  stackTrace: string | null
  context: Record<string, unknown>
  status: ErrorReviewStatus
  reviewedBy: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface FeatureFlag {
  id: string
  name: string
  description: string | null
  enabled: boolean
  clinicId: string | null
  rolloutPercentage: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface DevSeedRun {
  id: string
  name: string
  ranAt: string
  status: SeedRunStatus
  metadata: Record<string, unknown>
}

// ── Custom flows (P18 — Gap #34) ────────────────────────────────────────────────

export type CustomFlowAction   = 'book' | 'handoff' | 'end'
export type CustomFlowLanguage = 'es' | 'en' | 'both'
export type CustomFlowBranchOp = 'contains' | 'equals' | 'yes' | 'no' | 'any' | 'starts_with' | 'regex'
export type CustomFlowStepType = 'single_choice'
export type CustomFlowRenderMode = 'buttons' | 'list'
export type CustomFlowStoreAs = 'optionId' | 'title' | 'saveValue'

/** A conditional transition out of a waiting flow step. */
export interface CustomFlowBranch {
  op: CustomFlowBranchOp
  keywords?: string[]
  /** Match text for `op: 'regex'` (ignored otherwise). */
  pattern?: string
  /** Target step id, or a terminal token: 'book' | 'handoff' | 'end'. */
  next: string
}

/** A tappable option on a `single_choice` step (Punchlist Aug 3 parity spec). */
export interface CustomFlowChoiceOption {
  /** Unique within the node; sent as the WhatsApp interactive reply id. */
  optionId: string
  /** Tappable label (WhatsApp limit: 24 chars). */
  title: string
  /** Row subtitle; `renderMode: 'list'` only (WhatsApp limit: 72 chars). */
  description?: string
  /** Branch target: a stepId in this flow, or a terminal token. */
  goToNext: string
  /** Literal value written to the step's `collect` variable when chosen. */
  saveValue?: string
}

/** One node of a multi-step custom flow (Rev1 #28). */
export interface CustomFlowStep {
  id: string
  messages: string[]
  branches?: CustomFlowBranch[]
  collect?: string | null
  next?: string | null
  action?: CustomFlowAction | null
  // Single Choice (Punchlist Aug 3 parity spec) — a tappable WhatsApp
  // buttons/list menu that branches per option. Absent `type` = today's
  // legacy step; every field below is additive and optional.
  type?: CustomFlowStepType
  header?: string
  footer?: string
  renderMode?: CustomFlowRenderMode
  listButtonLabel?: string
  options?: CustomFlowChoiceOption[]
  /** What `collect` stores when an option is chosen (default 'optionId'). */
  storeAs?: CustomFlowStoreAs
  /** Sent on an unmatched reply when `defaultNext` (`next`) is null. */
  retryMessage?: string
  /** Unmatched-reply attempts allowed before routing to `onFailNext` (default 2). */
  maxRetries?: number
  /** Terminal/step after `maxRetries` exceeded (default 'handoff'). */
  onFailNext?: string
  // Visual-canvas node position (Rev 2). Stored in the steps JSONB; ignored by the
  // flow engine. Absent for legacy/form-built flows — the canvas auto-lays-out then.
  x?: number
  y?: number
}

/** A keyword-triggered scripted conversation flow that bypasses intent/LLM. */
export interface CustomFlow {
  id: string
  clinicId: string
  name: string
  triggerKeywords: string[]
  messages: string[]
  action: CustomFlowAction | null
  language: CustomFlowLanguage
  enabled: boolean
  // Rev1 #28 — step graph for multi-step / conditional flows. Empty for legacy
  // single-shot flows (which run from `messages`/`action`).
  steps: CustomFlowStep[]
  startStepId: string | null
  createdAt: string
  updatedAt: string
}

// ── Follow-ups (P18 — Gap #37) ──────────────────────────────────────────────────

export type FollowUpStatus = 'pending' | 'sent' | 'clicked' | 'skipped' | 'pending_approval' | 'rejected'

/** Tracks an automated follow-up (e.g. a post-appointment review request). */
export interface FollowUp {
  id: string
  clinicId: string
  patientId: string
  appointmentId: string | null
  type: string
  status: FollowUpStatus
  reviewSentAt: string | null
  reviewClickedAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// ── Rev 3: N8N-style automation workflows ───────────────────────────────────────
export type WorkflowStatus = 'draft' | 'active'
export type WorkflowNodeKind = 'trigger' | 'logic' | 'action'

/** One node on the workflow canvas. `type` is the concrete node (e.g.
 *  'trigger.no_show', 'logic.condition', 'action.send_template', 'action.approval');
 *  `config` is node-type-specific; x/y are the canvas position. */
export interface WorkflowNode {
  id: string
  kind: WorkflowNodeKind
  type: string
  config: Record<string, unknown>
  x: number
  y: number
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  /** Branch label out of a condition node (e.g. 'true' | 'false'). */
  sourceHandle?: string | null
}

export interface Workflow {
  id: string
  clinicId: string
  name: string
  status: WorkflowStatus
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: string
  updatedAt: string
}

// ── Generated reports (Req 37 — Automatic reports) ──────────────────────────────

export type ReportType = 'daily' | 'weekly' | 'monthly'

/**
 * A scheduled report generated for a clinic admin and delivered through the panel
 * (this persisted row) and email (`emailed`). `data` holds the structured figures
 * so the panel can re-render or aggregate without re-querying metrics.
 */
export interface GeneratedReport {
  id: string
  clinicId: string
  type: ReportType
  periodStart: string
  periodEnd: string
  subject: string
  html: string
  data: Record<string, unknown>
  recipientEmail: string | null
  emailed: boolean
  deliveryStatus?: 'pending' | 'sending' | 'failed' | 'sent'
  /** A bounded category, never a raw provider response, credential, or recipient. */
  deliveryDiagnostic?: string | null
  deliveryClaimedAt?: string | null
  deliveryClaimOwner?: string | null
  deliveryAttempts?: number
  createdAt: string
}

/** A per-device Web Push subscription (Req 39 — installed-PWA mobile alerts). */
export interface PushSubscriptionRow {
  id: string
  clinicId: string
  userId: string
  userEmail: string
  endpoint: string
  p256dh: string
  auth: string
  createdAt: string
  updatedAt: string
}
