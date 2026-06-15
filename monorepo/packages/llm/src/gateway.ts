import type {
  ChatProvider,
  EmbeddingProvider,
  GenerateRequest,
  GenerateResult,
  IntentProvider,
  IntentResult,
} from "./types.js";

/**
 * The single seam through which all model access flows. Swapping a provider (e.g.
 * Claude → a self-hosted model later) is a constructor change here; no caller is
 * touched. clinic_id never enters a prompt (principle #2) — callers pass only the
 * assembled, already-scoped content.
 */
export interface LlmGatewayOptions {
  chat: ChatProvider;
  intent: IntentProvider;
  embeddings: EmbeddingProvider;
}

export class LlmGateway {
  private readonly chat: ChatProvider;
  private readonly intent: IntentProvider;
  private readonly embeddings: EmbeddingProvider;

  constructor(opts: LlmGatewayOptions) {
    this.chat = opts.chat;
    this.intent = opts.intent;
    this.embeddings = opts.embeddings;
  }

  generate(req: GenerateRequest): Promise<GenerateResult> {
    return this.chat.generate(req);
  }

  classifyIntent(text: string, candidates: readonly string[]): Promise<IntentResult> {
    return this.intent.classify(text, candidates);
  }

  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.embeddings.embed([text]);
    return vec!;
  }

  embed(texts: readonly string[]): Promise<number[][]> {
    return this.embeddings.embed(texts);
  }

  get embeddingDimensions(): number {
    return this.embeddings.dimensions;
  }
}
