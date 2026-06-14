/**
 * @docmee/llm — provider-abstracted model gateway. OWNER: Prime.
 * Nothing outside this package talks to a model provider directly (principle #4).
 */
export { LlmGateway } from "./gateway.js";
export type { LlmGatewayOptions } from "./gateway.js";
export type {
  ChatProvider,
  IntentProvider,
  EmbeddingProvider,
  ChatMessage,
  GenerateRequest,
  GenerateResult,
  IntentResult,
  Locale,
} from "./types.js";
export { INTENTS, isIntent, type Intent } from "./intents.js";
export {
  assembleSystemPrompt,
  type AssembleOptions,
  type KbSnippet,
} from "./prompts/assembly.js";
export {
  FakeChatProvider,
  FakeIntentProvider,
  FakeEmbeddingProvider,
} from "./providers/fake.js";
export {
  ClaudeChatProvider,
  DeepSeekIntentProvider,
  OpenAiEmbeddingProvider,
  type RealProviderConfig,
} from "./providers/real.js";
