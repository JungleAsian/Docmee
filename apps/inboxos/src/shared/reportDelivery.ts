// Req 37 — Automatic reports. Derives the delivery state shown on each report row
// (and in the slide-over) from the two fields the reports worker persists.
//
// The worker emails every report to the clinic recipient (best-effort) and records
// `emailed=true` on success. A send that throws keeps the recipient on the row but
// leaves `emailed=false` (the email was attempted and failed — retry exhausted). A
// clinic with no admin email on file is stored with `recipientEmail=null`, so the
// report only ever lived in the panel. Those three combinations map cleanly onto
// the mockup's three delivery badges — no extra column needed.
export type DeliveryState = 'sent' | 'failed' | 'notsent'

export interface ReportDeliveryInput {
  emailed: boolean
  recipientEmail: string | null
}

export function reportDelivery(report: ReportDeliveryInput): DeliveryState {
  if (report.emailed) return 'sent'
  // Recipient on file but not emailed → the send was attempted and failed.
  // No recipient → nothing was ever sent; the report is panel-only.
  return report.recipientEmail ? 'failed' : 'notsent'
}
