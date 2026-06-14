/**
 * Provider-abstracted LLM types (principle #4: nothing calls a provider directly;
 * everything goes through the gateway). Data residency drives selection (principle
 * #3): Claude for patient-facing generation, DeepSeek for intent ONLY (no
 * fallback), OpenAI for embeddings.
 */
export type Locale = "es" | "en";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Patient-facing generation (Claude). */
export interface ChatProvider {
  readonly name: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export interface IntentResult {
  intent: string;
  confidence: number;
}

/** Intent classification ONLY (DeepSeek). Never used for generation. */
export interface IntentProvider {
  readonly name: string;
  classify(text: string, candidates: readonly string[]): Promise<IntentResult>;
}

/** Embeddings for KB retrieval (OpenAI text-embedding-3-small, 1536 dims). */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<number[][]>;
}
