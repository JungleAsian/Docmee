// Frontend-facing shapes. These mirror the API JSON responses (a subset of the
// @docmee/db row types) — kept local so the Next app has no workspace dependency
// on the database package.

import type { ClinicRule } from './clinicRules'
import type { AutomationsConfig } from './automations'
import type { AiAssistantConfig } from './aiAssistant'
import type { RoleMenuVisibility, RolePermissions } from './roleAccess'

export type PanelRole = 'secretary' | 'doctor' | 'clinic_admin' | 'ia_studio_admin'
export type PanelLanguage = 'es' | 'en'

export interface AuthUser {
  id: string
  accountUserId?: string
  email: string
  fullName?: string | null
  role: PanelRole
  clinicId: string
  clinicIds?: string[]
  permissions?: string[]
  isGlobalSuperAdmin?: boolean
  inactivityTimeoutMinutes?: number
  jzelEnabled?: boolean
}

// Req 11: 7-state conversation lifecycle (mirrors @docmee/db).
export type ConversationStatus =
  | 'open'
  | 'pending'
  | 'assigned'
  | 'handoff'
  | 'snoozed'
  | 'resolved'
  | 'archived'
export type Channel = 'whatsapp' | 'messenger' | 'instagram'
export type MessageRole = 'user' | 'assistant' | 'system' | 'agent'
export type ContentType = 'text' | 'audio' | 'image' | 'template' | 'interactive'
export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed'

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
  metadata: Record<string, unknown>
  // Req 20: tag names linked to the thread, attached by GET /conversations so the
  // list can flag urgent/safety threads without a per-row fetch. Absent on the
  // single-conversation detail endpoint (the tag panel fetches those separately).
  tags?: string[]
  // Req 4/35: the thread's most recent message, attached by GET /conversations so
  // the list row can render a preview line. `null` when the thread has no messages
  // yet; absent on the single-conversation detail endpoint.
  lastMessage?: {
    content: string
    contentType: ContentType
    role: MessageRole
  } | null
  // The linked patient's display name, attached by GET /conversations (list) and
  // GET /conversations/:id (detail) so the list row + thread header can show who the
  // patient is instead of the raw channel handle (a phone number / IGSID). `null`
  // when the thread has no patient or the patient has no name on file.
  patientName?: string | null
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  conversationId: string
  clinicId: string
  role: MessageRole
  content: string
  contentType: ContentType
  transcription: string | null
  // Req 3: latest delivery state for an outbound message (sent/delivered/read/
  // failed). null/absent for inbound messages and sends with no receipt yet.
  deliveryStatus?: DeliveryStatus | null
  createdAt: string
  metadata: Record<string, unknown>
  /** Structured classifier output, when the inbound message has been classified. */
  classification?: {
    intent?: string
    confidence?: number
    provider?: string
    model?: string
    classifierVersion?: string
    source?: string
    classifiedAt?: string
  } | null
}

export interface Tag {
  id: string
  clinicId: string
  name: string
  color: string
  createdAt: string
}

export interface Note {
  id: string
  conversationId: string
  clinicId: string
  authorId: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface TeamMember {
  id: string
  fullName: string | null
  email: string
  status: string
  role?: PanelRole
}

// ── Clinic users (Req 1 — Admin Studio user management) ───────────────────────────
export type ClinicUserStatus = 'active' | 'inactive' | 'invited'
/** Roles assignable through per-clinic user management (ia_studio_admin excluded). */
export type AssignableRole = 'secretary' | 'doctor' | 'clinic_admin'

export interface ClinicUser {
  id: string
  clinicId: string
  email: string
  fullName: string | null
  status: ClinicUserStatus
  role: PanelRole
  panelLanguage: PanelLanguage
  inactivityTimeoutMinutes: number
  notificationPrefs?: {
    emailEnabled: boolean
    mutedTypes: string[]
    soundEnabled?: boolean
    jzelEnabled?: boolean
    alertCategories?: {
      whatsapp: boolean
      internal: boolean
      newBooking: boolean
      cancellation: boolean
      bookingRevision: boolean
    }
  }
  lastSeen: string | null
  createdAt: string
  updatedAt: string
}

// ── Quick reply templates (P16 — Gap #25) ──────────────────────────────────────
export interface QuickReplyTemplate {
  id: string
  clinicId: string
  title: string
  content: string
  category: string
  createdAt: string
  updatedAt: string
}

// ── WhatsApp message templates (P16 — Gap #29) ─────────────────────────────────
export type MessageTemplateStatus = 'pending' | 'approved' | 'rejected'
export type MessageTemplateCategory =
  | 'appointment_confirmation'
  | 'appointment_reminder'
  | 'human_handoff_notification'
  | 'review_request'

export interface MessageTemplate {
  id: string
  clinicId: string
  name: string
  category: MessageTemplateCategory
  language: string
  body: string
  status: MessageTemplateStatus
  metaTemplateId?: string | null
  metaStatus?: string | null
  metaLastSyncedAt?: string | null
  metaLastError?: string | null
  createdAt: string
  updatedAt: string
}

// ── Patient history (P16 — Gap #26) ────────────────────────────────────────────
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

// Screen 2 — the appointment lifecycle. 'arrived' (checked in) and 'in_progress'
// (visit underway) sit between 'confirmed' and 'completed' (mirrors @docmee/db).
export type AppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'arrived'
  | 'in_progress'
  | 'cancelled'
  | 'completed'
  | 'no_show'

export type AppointmentEventType =
  | 'created'
  | 'confirmed'
  | 'arrived'
  | 'in_progress'
  | 'cancelled'
  | 'rescheduled'
  | 'completed'
  | 'no_show'
  | 'reminder_sent'

export interface Appointment {
  id: string
  clinicId: string
  patientId: string
  providerId: string | null
  doctorId: string | null
  serviceId: string | null
  // Screen 2: present when the AI booked the appointment over a channel (WhatsApp).
  // null when a staff member booked it by hand → drives the AI-vs-staff source mark.
  conversationId: string | null
  googleEventId: string | null
  status: AppointmentStatus
  startTime: string
  endTime: string
  notes: string | null
  // Screen 2: metadata.urgent flags an urgent appointment (red card + tag).
  metadata: Record<string, unknown>
  // True while the row doesn't yet reflect its intended Google Calendar state
  // (create/update/delete owed) — the appointment itself is always saved
  // regardless; this only tracks the best-effort Calendar side-effect.
  calendarSyncPending: boolean
  calendarSyncError: string | null
  createdAt: string
}

// Screen 2 (AI booking & calendar) — an appointment enriched with the names the
// operational calendar renders, returned by GET /clinics/:id/appointments.
export interface AppointmentWithNames extends Appointment {
  patientName: string | null
  doctorName: string | null
  serviceName: string | null
  serviceDurationMinutes: number | null
}

/** A row of the calendar's "AI booking activity" feed (GET .../appointments/events). */
export interface AppointmentEventFeedItem {
  id: string
  appointmentId: string
  eventType: AppointmentEventType
  createdAt: string
  patientName: string | null
  startTime: string
  /** True when the underlying appointment was AI-booked over a channel. */
  aiSourced: boolean
}

/** A bookable start time, returned by GET /clinics/:id/appointments/slots. */
export interface BookingSlot {
  start: string // HH:MM
  end: string // HH:MM
  /** Present for secretary calendar views that request occupied slots. */
  bookedCount?: number
  overbookingCapacity?: number
  parallelAvailable?: boolean
}

export interface SlotsResponse {
  date: string
  doctorId: string
  durationMinutes: number
  /** Whether this doctor's Google Calendar is connected (drives the disconnected banner). */
  calendarConnected: boolean
  /** Whether the doctor works on this date at all (false → day off). */
  working: boolean
  slots: BookingSlot[]
}

/** Minimal patient row for the booking picker (GET /clinics/:id/appointments/patients). */
export interface BookingPatient {
  id: string
  fullName: string | null
  duplicateName?: boolean
}

// ── Metrics dashboard (P16 — Gap #27) ──────────────────────────────────────────
export interface ClinicMetrics {
  conversationsToday: number
  messagesToday: number
  botReplyRate: number
  avgResponseSeconds: number
  conversationsPerDay: Array<{ date: string; count: number }>
  topIntents: Array<{ intent: string; count: number }>
  totalConversations: number
  conversationsByChannel: Array<{ channel: string; count: number }>
  leads: number
  bookings: number
  bookingConversionRate: number
  transferRate: number
  noResponseRate: number
  noShowRate: number
  peakHours: Array<{ dayOfWeek: number; hour: number; count: number }>
  // Screen 14 (metrics dashboard) additions.
  bookingsToday: number
  resolutionSplit: { bot: number; human: number; urgent: number }
  previous: { totalConversations: number; bookings: number }
}

// ── Quality of Service monitoring (Req 32) ─────────────────────────────────────
export interface QosAttentionItem {
  conversationId: string
  patientName: string
  status: string
  channel: string
  reason: 'upset' | 'abandoned' | 'unclosed'
  /** Who is handling the thread now — a human secretary owns it, or the bot is auto-answering. */
  mode: 'bot' | 'human'
  lastMessageAt: string | null
}

export interface ClinicQos {
  upsetPatients: number
  upsetUnresolved: number
  abandonedConversations: number
  avgBotResponseSeconds: number
  avgSecretaryResponseSeconds: number
  unclosedConversations: number
  unclosedAged: number
  followUpOpportunities: number
  pendingFollowUps: number
  staleHours: number
  attention: QosAttentionItem[]
}

// ── Automatic reports (Req 37) ──────────────────────────────────────────────────
export type ReportType = 'daily' | 'weekly' | 'monthly'

/** List-row shape (no html body — fetched per report on open). */
export interface ReportSummary {
  id: string
  type: ReportType
  periodStart: string
  periodEnd: string
  subject: string
  recipientEmail: string | null
  emailed: boolean
  createdAt: string
}

export interface GeneratedReport extends ReportSummary {
  html: string
  data: Record<string, unknown>
}

// Follow-up automation activity (Screen 12 / CRE-309).
export type FollowUpStatus = 'pending' | 'sent' | 'clicked' | 'skipped' | 'pending_approval' | 'rejected'

export interface FollowUpActivity {
  id: string
  type: string
  status: FollowUpStatus
  patientId: string
  appointmentId: string | null
  reviewSentAt: string | null
  reviewClickedAt: string | null
  createdAt: string
}

export type ClinicPlan = 'starter' | 'pro' | 'enterprise'
export type ClinicStatus = 'active' | 'suspended' | 'cancelled'

export interface Clinic {
  id: string
  name: string
  slug: string
  plan: ClinicPlan
  status: ClinicStatus
  timezone: string
  settings: Record<string, unknown>
  address?: string | null
  phone?: string | null
  clinicType?: string | null
  // P14 — Facebook Messenger connection. The access token is write-only and is
  // never sent back to the panel, so it is not exposed here.
  messengerPageId?: string | null
  messengerWebhookVerifyToken?: string | null
  messengerEnabled?: boolean
  // P15 — Instagram Direct connection. The access token is write-only and is
  // never sent back to the panel, so it is not exposed here.
  instagramAccountId?: string | null
  instagramWebhookVerifyToken?: string | null
  instagramEnabled?: boolean
  createdAt: string
  updatedAt: string
}

export type DocumentType = 'faq' | 'policy' | 'service_info' | 'custom'
export type DocumentStatus = 'active' | 'draft' | 'archived'

export interface KnowledgeDocument {
  id: string
  clinicId: string
  title: string
  content: string
  documentType: DocumentType
  status: DocumentStatus
  /** Per-doctor FAQ scope (Req 30): metadata.doctorId limits the doc to one doctor.
   *  source/ocr (set by the upload pipeline) drive the Screen 7 source-confidence badge. */
  metadata?: {
    doctorId?: string | null
    source?: 'document' | 'manual'
    ocr?: boolean
    format?: string
  } & Record<string, unknown>
  /** Screen 7 training state — total chunks and how many already carry an embedding.
   *  Attached by GET /clinics/:id/kb; absent on create/patch responses. */
  chunkCount?: number
  embeddedCount?: number
  createdAt: string
  updatedAt: string
}

export type ErrorReviewStatus = 'open' | 'reviewed' | 'resolved' | 'ignored'

export interface ErrorReview {
  id: string
  clinicId: string | null
  errorType: string
  errorMessage: string
  stackTrace: string | null
  context: Record<string, unknown>
  status: ErrorReviewStatus
  // Set when an operator resolves the review; surfaced as the assignee + the
  // "Resolved · 7d" stat on the Error Review queue (Screen 9).
  reviewedBy: string | null
  resolvedAt: string | null
  createdAt: string
}

export interface ClinicStats {
  activeConversations: number
  totalPatients: number
  activeClinics?: number
}

// ── Bot configuration (stored in clinic.settings) ──────────────────────────────
export type BotTone = 'professional' | 'friendly' | 'brief'

// Bilingual bot (Req 22): the clinic-forced reply language. 'auto' detects the
// patient's language on the first message then follows it; 'es'/'en' force every
// reply into that language. Mirrors @docmee/agents BotLanguage / the worker's
// getClinicBotConfig, which reads this off the flat settings.botLanguage key.
export type BotLanguage = 'auto' | 'es' | 'en'

export interface DayHours {
  open: string // 'HH:mm'
  close: string // 'HH:mm'
  closed?: boolean
}

/** Map of lowercase weekday ('monday' … 'sunday') → hours. Mirrors @docmee/agents. */
export type BusinessHours = Record<string, DayHours>

/** The subset of clinic.settings the Admin Studio reads/writes. All keys optional. */
export interface ClinicSettings {
  botTone?: BotTone
  botLanguage?: BotLanguage
  // Flat string the agents layer reads — recompiled from the ACTIVE rules below.
  clinicRules?: string
  // Structured editor state (text + active flag, incl. inactive rules) — Screen 8.
  clinicRulesList?: ClinicRule[]
  // Sent verbatim (no LLM) when a patient's message matches no configured
  // workflow/custom-flow keyword — any time of day. A blank field falls back
  // to the built-in default text; see resolveUnmatchedKeywordMessage in
  // apps/workers/src/agent-processor.worker.ts.
  unmatchedKeywordMessage?: { es?: string; en?: string }
  businessHours?: BusinessHours
  bookingGrid?: { startHour: number; endHour: number; slotMinutes: number }
  stalledConversation?: { stallMinutes?: number; reannounceIntervalMinutes?: number; maxReannouncements?: number; closeGraceMinutes?: number }
  googleCalendar?: { calendarId?: string } & Record<string, unknown>
  googleSheets?: { spreadsheetId?: string; sheetName?: string; enabled?: boolean } & Record<
    string,
    unknown
  >
  // Meta Page-token expiry dates (Req 19). Set in the panel so the
  // conversation-processor can raise META_TOKEN_EXPIRING before the token lapses.
  // WhatsApp's expiry lives on channel_accounts.settings.tokenExpiresAt, not here.
  messengerTokenExpiresAt?: string
  instagramTokenExpiresAt?: string
  license_key?: string
  // Screen 12 (Automation & follow-ups). reviewLink is where the review-request
  // worker points patients; automations gates the follow-up/review automations.
  reviewLink?: string
  automations?: AutomationsConfig
  // Screen 12 (AI Assistant section). Per-clinic J.zel config: model, persona,
  // knowledge sources. One clinic = one J.zel.
  aiAssistant?: AiAssistantConfig
  // Admin Studio users: per-clinic role permissions and side rail visibility.
  rolePermissions?: Partial<RolePermissions>
  roleMenuVisibility?: Partial<RoleMenuVisibility>
  // Whether the floating chat bubble is shown for this clinic. Defaults to on
  // (only an explicit `false` hides it), so existing clinics keep the widget.
  floatingChatbox?: boolean
  [key: string]: unknown
}

// ── License (decoded by the API, display-only) ─────────────────────────────────
export type LicenseState = 'none' | 'active' | 'expired' | 'invalid'

export interface ClinicLicense {
  state: LicenseState
  clinicName?: string
  seats?: number
  issuedAt?: string
  expiresAt?: string
}

// ── AI usage (from ai_usage_events) ────────────────────────────────────────────
export interface ClinicUsage {
  clinicId: string
  totalCostUsd: number
  totalTokens: number
  promptTokens: number
  completionTokens: number
  eventCount: number
  byModel: Array<{ model: string; costUsd: number; totalTokens: number; eventCount: number }>
}

export interface ClinicUsageRow {
  clinicId: string
  clinicName: string
  totalCostUsd: number
  totalTokens: number
  eventCount: number
}

// ── P18 — Phase 3 ────────────────────────────────────────────────────────────────

/** Req 30: per-doctor weekly working hours. */
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export interface TimeRange {
  start: string // HH:MM
  end: string // HH:MM
}
export type DoctorAvailability = Partial<Record<Weekday, TimeRange[]>>

/** A doctor (redacted — calendar tokens are never returned to the panel). */
export interface Doctor {
  id: string
  clinicId: string
  name: string
  specialty: string | null
  googleCalendarId: string | null
  availableDays: DoctorAvailability
  isActive: boolean
  calendarConnected: boolean
  createdAt: string
  updatedAt: string
}

/** Req 30: a clinic service the bot can book (its duration sets the slot length). */
export interface Service {
  id: string
  clinicId: string
  name: string
  description: string | null
  durationMinutes: number
  price: string | null
  currency: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type CustomFlowAction = 'book' | 'handoff' | 'end'
export type CustomFlowLanguage = 'es' | 'en' | 'both'
export type CustomFlowBranchOp = 'contains' | 'equals' | 'yes' | 'no' | 'any' | 'starts_with' | 'regex'
export type CustomFlowStepType = 'single_choice'
export type CustomFlowRenderMode = 'buttons' | 'list'
export type CustomFlowStoreAs = 'optionId' | 'title' | 'saveValue'

export interface CustomFlowBranch {
  op: CustomFlowBranchOp
  keywords?: string[]
  /** Match text for `op: 'regex'` (ignored otherwise). */
  pattern?: string
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

export interface CustomFlowStep {
  id: string
  messages: string[]
  branches?: CustomFlowBranch[]
  collect?: string | null
  next?: string | null
  action?: CustomFlowAction | null
  // Single Choice — a tappable WhatsApp buttons/list menu that branches per
  // option. Absent `type` = today's legacy step; fields below are additive.
  type?: CustomFlowStepType
  header?: string
  footer?: string
  renderMode?: CustomFlowRenderMode
  listButtonLabel?: string
  options?: CustomFlowChoiceOption[]
  /** What `collect` stores when an option is chosen (default 'optionId'). */
  storeAs?: CustomFlowStoreAs
  /** Sent on an unmatched reply when `next` (the default transition) is null. */
  retryMessage?: string
  /** Unmatched-reply attempts allowed before routing to `onFailNext` (default 2). */
  maxRetries?: number
  /** Terminal/step after `maxRetries` exceeded (default 'handoff'). */
  onFailNext?: string
  /** Visual-canvas node position (Rev 2). Persisted in the steps JSONB. */
  x?: number
  y?: number
}

export interface CustomFlow {
  id: string
  clinicId: string
  name: string
  triggerKeywords: string[]
  messages: string[]
  action: CustomFlowAction | null
  language: CustomFlowLanguage
  enabled: boolean
  steps: CustomFlowStep[]
  startStepId: string | null
  createdAt: string
  updatedAt: string
}

// ── Rev 3: N8N-style automation workflows ───────────────────────────────────────
export type WorkflowStatus = 'draft' | 'active'
export type WorkflowNodeKind = 'trigger' | 'logic' | 'action'
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

/** A prebuilt flow served by GET /clinics/:id/custom-flows/templates. */
export interface FlowTemplate {
  key: string
  name: string
  triggerKeywords: string[]
  language: CustomFlowLanguage
  startStepId: string
  steps: CustomFlowStep[]
  action?: CustomFlowAction | null
}

// ── Notifications (Req 24) ─────────────────────────────────────────────────────
/** Delivery channel a notification was routed to (mirrors @docmee/db). */
export type NotificationDeliveryType = 'email' | 'in_app'
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'acknowledged'

/** A row from the notification feed (GET /notifications). */
export interface NotificationEvent {
  id: string
  clinicId: string | null
  notificationType: NotificationDeliveryType
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
  metadata: Record<string, unknown>
  createdAt: string
}

/** Per-user notification preferences (GET/PUT /user/notification-preferences). */
export type AlertCategoryKey =
  | 'whatsapp'
  | 'internal'
  | 'newBooking'
  | 'cancellation'
  | 'bookingRevision'
  | 'newMessage'
export type AlertCategories = Record<AlertCategoryKey, boolean>
/** Item 4 of the 25-item batch: which synthesized tone plays per alert category. */
export type SoundPreset = 'default' | 'chime' | 'ping' | 'bell'

export interface NotificationPrefs {
  emailEnabled: boolean
  mutedTypes: string[]
  alertCategories?: AlertCategories
  soundEnabled: boolean
  soundId?: SoundPreset
  volume?: number
  soundPresets?: Partial<Record<AlertCategoryKey, SoundPreset>>
  jzelEnabled?: boolean
}

export interface AdvancedAnalytics {
  totalConversations: number
  resolutionRate: number
  avgConversationLength: number
  handoffRate: number
  /** Fraction (0..1) of conversations resolved by the bot with no human handoff. */
  automationRate: number
  kbHitRate: number
  newPatients: number
  returningPatients: number
  peakHours: Array<{ dayOfWeek: number; hour: number; count: number }>
}

// Req 40: server feature flags, surfaced via GET /config so the panel can gate
// optional surfaces (e.g. the advanced analytics dashboard).
export interface Features {
  advancedAnalytics: boolean
}
