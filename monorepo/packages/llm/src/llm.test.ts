import { describe, expect, it } from "vitest";
import { assembleSystemPrompt } from "./prompts/assembly.js";
import { FakeEmbeddingProvider, FakeIntentProvider } from "./providers/fake.js";
import { INTENTS } from "./intents.js";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // vectors are unit-normalized
}

describe("prompt assembly", () => {
  it("always injects safety rules and clinic rules in full", () => {
    const prompt = assembleSystemPrompt({
      locale: "es",
      clinicRules: ["Horario: L-V 8-17."],
      kbSnippets: [],
    });
    expect(prompt).toContain("NUNCA diagnostiques");
    expect(prompt).toContain("Horario: L-V 8-17.");
  });

  it("drops low-similarity KB snippets first under a tight budget (fail-safe)", () => {
    const high = "HIGH similarity snippet";
    const header = assembleSystemPrompt({ locale: "es", clinicRules: [], kbSnippets: [] });
    // Budget for exactly one snippet block (content + the 2-char separator).
    const maxChars = header.length + high.length + 2 + 1;
    const prompt = assembleSystemPrompt({
      locale: "es",
      clinicRules: [],
      kbSnippets: [
        { content: high, similarity: 0.95 },
        { content: "LOW similarity snippet", similarity: 0.71 },
      ],
      maxChars,
    });
    expect(prompt).toContain("HIGH similarity snippet");
    expect(prompt).not.toContain("LOW similarity snippet");
  });

  it("never truncates safety rules even with zero budget", () => {
    const prompt = assembleSystemPrompt({
      locale: "en",
      clinicRules: [],
      kbSnippets: [{ content: "x".repeat(1000), similarity: 0.99 }],
      maxChars: 1,
    });
    expect(prompt).toContain("NEVER diagnose");
    expect(prompt).not.toContain("xxxx");
  });
});

describe("fake intent provider", () => {
  it("classifies booking, status, handoff, question, other", async () => {
    const p = new FakeIntentProvider();
    expect((await p.classify("Quiero agendar una cita", INTENTS)).intent).toBe("booking");
    expect((await p.classify("¿Cuándo es mi cita?", INTENTS)).intent).toBe("appointment_status");
    expect((await p.classify("Quiero hablar con una persona", INTENTS)).intent).toBe("handoff");
    expect((await p.classify("¿Qué horario tienen?", INTENTS)).intent).toBe("question");
    expect((await p.classify("ok gracias", INTENTS)).intent).toBe("other");
  });
});

describe("fake embedding provider", () => {
  it("gives higher similarity to texts that share words", async () => {
    const e = new FakeEmbeddingProvider(256);
    const [q, near, far] = await e.embed([
      "horario de atención",
      "cuál es el horario",
      "ubicación del parqueo",
    ]);
    expect(cosine(q!, near!)).toBeGreaterThan(cosine(q!, far!));
  });
});
