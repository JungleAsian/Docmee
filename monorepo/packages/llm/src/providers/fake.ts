import { createHash } from "node:crypto";
import type {
  ChatProvider,
  EmbeddingProvider,
  GenerateRequest,
  GenerateResult,
  IntentProvider,
  IntentResult,
} from "../types.js";

/**
 * Deterministic fakes for local dev + tests (no API keys / X5 needed). They make
 * the pipeline fully exercisable; swapping in the real Claude/DeepSeek/OpenAI
 * providers is a constructor change at the gateway.
 */
export class FakeChatProvider implements ChatProvider {
  readonly name = "fake-chat";
   
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const last = req.messages.at(-1)?.content ?? "";
    return { text: `[fake reply] ${last}`, usage: { outputTokens: 8 } };
  }
}

const BOOKING = ["cita", "agendar", "reservar", "book", "appointment", "turno"];
const STATUS = ["estado", "status", "confirmar", "mi cita", "cuando es"];
const HANDOFF = ["hablar con", "persona", "humano", "secretaria", "human", "agent"];

/** Keyword heuristic intent classifier (stands in for DeepSeek). */
export class FakeIntentProvider implements IntentProvider {
  readonly name = "fake-intent";
   
  async classify(text: string, candidates: readonly string[]): Promise<IntentResult> {
    const t = text.toLowerCase();
    const pick = (i: string): boolean => candidates.includes(i);
    if (pick("handoff") && HANDOFF.some((k) => t.includes(k)))
      return { intent: "handoff", confidence: 0.95 };
    if (pick("appointment_status") && STATUS.some((k) => t.includes(k)))
      return { intent: "appointment_status", confidence: 0.85 };
    if (pick("booking") && BOOKING.some((k) => t.includes(k)))
      return { intent: "booking", confidence: 0.9 };
    if (pick("question") && /[?¿]|qué|cómo|cuál|dónde|what|how|where/.test(t))
      return { intent: "question", confidence: 0.8 };
    return { intent: "other", confidence: 0.5 };
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

/**
 * Feature-hashing bag-of-words embedding: deterministic AND semantically useful
 * (texts sharing words get higher cosine similarity), so KB-retrieval thresholds
 * are testable without a real embedding model.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = "fake-embedding";
  readonly dimensions: number;

  constructor(dimensions = 1536) {
    this.dimensions = dimensions;
  }

   
  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((t) => this.vectorize(t));
  }

  private vectorize(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    for (const token of tokenize(text)) {
      const h = createHash("md5").update(token).digest();
      const idx = h.readUInt32BE(0) % this.dimensions;
      const sign = (h[4]! & 1) === 0 ? 1 : -1;
      vec[idx] = vec[idx]! + sign;
    }
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
    return vec.map((x) => x / norm);
  }
}
