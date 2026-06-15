/**
 * @docmee/agents — the conversation pipeline. OWNER: Prime.
 * Orchestrates db + llm into the bot turn; nothing here talks to a provider
 * directly (that's the gateway) or to the DB outside the RLS chokepoint.
 */
export { processTurn } from "./pipeline.js";
export type {
  PipelineDeps,
  TurnInput,
  TurnResult,
} from "./pipeline.js";
export { bookAppointment } from "./scheduling.js";
export type { BookingDeps, BookParams, BookResult } from "./scheduling.js";
export {
  runAutomationJob,
  processDueAutomations,
  cancelAppointmentAutomations,
  autoCompleteAppointments,
} from "./automation.js";
export type { AutomationDeps, AutomationOutcome } from "./automation.js";
export { suggestReply } from "./copilot.js";
export type { CopilotDeps, CopilotSuggestion } from "./copilot.js";
export { ingestDocument } from "./documents.js";
export type { DocumentIngestDeps } from "./documents.js";
export { exportPatient } from "./export.js";
export type { ExportSink, ExportResult } from "./export.js";
export { notifyUserPush } from "./push.js";
export type { PushDeps } from "./push.js";
export { createWhatsAppTransport } from "./transport.js";
export type { WhatsAppTransportDeps } from "./transport.js";
