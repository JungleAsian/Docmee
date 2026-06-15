import type {
  ChatProvider,
  EmbeddingProvider,
  GenerateRequest,
  GenerateResult,
  IntentProvider,
  IntentResult,
} from "../types.js";
import { isIntent } from "../intents.js";

/**
 * Real provider adapters (fetch-based; no SDK weight). These are WIRED but only
 * activated when X5 keys are present — not exercised by the test suite. Swapping
 * them in for the fakes is a constructor change at the gateway.
 *
 * Locked selection (architecture §15): Claude Sonnet 4.6 generation · DeepSeek
 * intent-only · OpenAI text-embedding-3-small.
 */
export interface RealProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export class ClaudeChatProvider implements ChatProvider {
  readonly name = "claude";
  private readonly cfg: Required<RealProviderConfig>;
  constructor(cfg: RealProviderConfig) {
    this.cfg = {
      model: "claude-sonnet-4-6",
      baseUrl: "https://api.anthropic.com",
      ...cfg,
    };
  }
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const res = await fetch(`${this.cfg.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.3,
        system: req.system,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}`);
    const json = (await res.json()) as {
      content: { text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      text: json.content.map((c) => c.text ?? "").join(""),
      usage: {
        inputTokens: json.usage?.input_tokens,
        outputTokens: json.usage?.output_tokens,
      },
    };
  }
}

export class DeepSeekIntentProvider implements IntentProvider {
  readonly name = "deepseek";
  private readonly cfg: Required<RealProviderConfig>;
  constructor(cfg: RealProviderConfig) {
    this.cfg = { model: "deepseek-chat", baseUrl: "https://api.deepseek.com", ...cfg };
  }
  async classify(text: string, candidates: readonly string[]): Promise<IntentResult> {
    const res = await fetch(`${this.cfg.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `Classify the patient message into exactly one intent. Reply with only the label. Options: ${candidates.join(", ")}.`,
          },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek API ${res.status}`);
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    const label = (json.choices[0]?.message.content ?? "").trim().toLowerCase();
    return isIntent(label)
      ? { intent: label, confidence: 0.9 }
      : { intent: "other", confidence: 0.4 };
  }
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly dimensions = 1536;
  private readonly cfg: Required<RealProviderConfig>;
  constructor(cfg: RealProviderConfig) {
    this.cfg = {
      model: "text-embedding-3-small",
      baseUrl: "https://api.openai.com",
      ...cfg,
    };
  }
  async embed(texts: readonly string[]): Promise<number[][]> {
    const res = await fetch(`${this.cfg.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({ model: this.cfg.model, input: texts }),
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }
}
