import type { Conversation, Appointment } from "@docmee/contracts";
import type { conversations, appointments } from "@docmee/db";

/**
 * Map snake_case DAL rows to the camelCase contract shapes the FE consumes
 * (packages/contracts). The contract is the seam — API responses MUST match it,
 * not leak DB column names.
 */
export function toConversation(
  row: conversations.ConversationRow,
): Conversation {
  return {
    id: row.id,
    patientId: row.patient_id,
    channel: row.channel as Conversation["channel"],
    mode: row.mode as Conversation["mode"],
    assigneeId: row.assignee_id,
    lastInteractionAt: row.last_interaction_at,
    windowExpiresAt: row.window_expires_at,
  };
}

export function toAppointment(
  row: appointments.AppointmentRow,
): Appointment {
  return {
    id: row.id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    status: row.status,
    startAt: row.start_at,
    endAt: row.end_at,
  };
}
