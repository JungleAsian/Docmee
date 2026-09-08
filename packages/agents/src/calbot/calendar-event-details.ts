export interface CalendarBookingDetails {
  serviceName?: string | null
  patientName?: string | null
  patientPhone?: string | null
  reason?: string | null
}

/** Builds the human-readable title and description used for every booking event. */
export function formatCalendarBooking(details: CalendarBookingDetails): { title: string; description: string } {
  const service = details.serviceName?.trim() || 'Clinic appointment'
  const patient = details.patientName?.trim() || 'Patient'
  const phone = details.patientPhone?.trim() || 'Not provided'
  const reason = details.reason?.trim() || 'Not provided'
  return {
    title: `${service} - ${patient}`,
    description: `Details:\nPatient phone: ${phone}\nReason for visit: ${reason}`,
  }
}
