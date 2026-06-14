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
