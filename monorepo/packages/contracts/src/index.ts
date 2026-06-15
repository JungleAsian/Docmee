/**
 * @docmee/contracts — THE SEAM between Agent BE (implements) and Agent FE (consumes).
 *
 * `openapi.gen.ts` is generated from `openapi.yaml` via `pnpm --filter @docmee/contracts generate`
 * (also run by `build`/`typecheck`). Do not edit the generated file by hand — edit the YAML.
 *
 * This module re-exports the raw generated `paths`/`components`/`operations` plus
 * ergonomic named aliases for the schemas BE and FE pass across the wire.
 */
import type { components, paths } from "./generated/openapi.gen.js";

export type { components, paths } from "./generated/openapi.gen.js";
export type { operations } from "./generated/openapi.gen.js";

type Schemas = components["schemas"];

// --- Schema aliases (the data shapes both lanes share) ---
export type Session = Schemas["Session"];
export type User = Schemas["User"];
export type Patient = Schemas["Patient"];
export type PatientCreate = Schemas["PatientCreate"];
export type PatientPage = Schemas["PatientPage"];
export type Conversation = Schemas["Conversation"];
export type ConversationPage = Schemas["ConversationPage"];
export type Message = Schemas["Message"];
export type MessageCreate = Schemas["MessageCreate"];
export type MessagePage = Schemas["MessagePage"];
export type Appointment = Schemas["Appointment"];
export type AppointmentCreate = Schemas["AppointmentCreate"];
export type AppointmentPage = Schemas["AppointmentPage"];
export type KbEntry = Schemas["KbEntry"];
export type KbEntryCreate = Schemas["KbEntryCreate"];
export type KbEntryPage = Schemas["KbEntryPage"];

/** The common error envelope used by every non-2xx response. */
export type ApiError = Schemas["Error"];

// --- Enumerated unions, re-exported as values for runtime use ---
export type Role = NonNullable<Session["role"]>;
export type Locale = NonNullable<Session["locale"]>;
export type Channel = NonNullable<Conversation["channel"]>;
export type ConversationMode = NonNullable<Conversation["mode"]>;
export type AppointmentStatus = NonNullable<Appointment["status"]>;

export const ROLES = ["doctor", "secretary", "admin", "assistant", "platform"] as const;
export const LOCALES = ["es", "en"] as const;
export const CHANNELS = ["whatsapp", "messenger", "instagram"] as const;
export const CONVERSATION_MODES = ["bot", "human", "paused", "resolved"] as const;
export const APPOINTMENT_STATUSES = [
  "booked",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
] as const;

/**
 * Realtime events (not REST). The inbox subscribes per active clinic; BE authorizes
 * the subscription against the session's clinic (RLS). Channel transport is
 * Supabase Realtime / WebSocket — see openapi.yaml trailer.
 */
export type RealtimeEvent =
  | { event: "message.created"; data: Message }
  | { event: "conversation.updated"; data: Conversation };

/** Helper paths type so consumers can derive request/response shapes per route. */
export type Paths = paths;
