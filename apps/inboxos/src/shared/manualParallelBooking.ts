export interface ManualParallelBookingDetails {
  patientName: string
  serviceId: string
  reason: string
}

export function isManualParallelBookingComplete(details: ManualParallelBookingDetails): boolean {
  return Boolean(details.patientName.trim() && details.serviceId.trim() && details.reason.trim())
}

/** Map the secretary-only patient form to the existing appointments API contract. */
export function buildManualParallelBookingFields(details: ManualParallelBookingDetails) {
  const reason = details.reason.trim()
  return {
    patientName: details.patientName.trim(),
    serviceId: details.serviceId.trim(),
    notes: reason,
    overbook: true as const,
    overbookingReason: reason,
  }
}
