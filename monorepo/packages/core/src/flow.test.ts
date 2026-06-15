import { describe, expect, it } from "vitest";
import { flowAdvance, flowFirstPrompt, type FlowDefinition } from "./flow.js";

const flow: FlowDefinition = {
  start: "ask_type",
  steps: {
    ask_type: {
      key: "ask_type",
      prompt: "¿Consulta nueva o seguimiento?",
      branches: [
        { equals: "nueva", next: "ask_reason" },
        { equals: "seguimiento", next: "ask_last_visit" },
      ],
      defaultNext: "ask_reason",
    },
    ask_reason: { key: "ask_reason", prompt: "¿Motivo?", next: "done" },
    ask_last_visit: { key: "ask_last_visit", prompt: "¿Última visita?", next: "done" },
    done: { key: "done", prompt: "¡Gracias!" },
  },
};

describe("declarative flow engine (Phase 3B)", () => {
  it("exposes the first prompt", () => {
    expect(flowFirstPrompt(flow)).toBe("¿Consulta nueva o seguimiento?");
  });

  it("branches on the patient's answer", () => {
    expect(flowAdvance(flow, "ask_type", "seguimiento").nextKey).toBe("ask_last_visit");
    expect(flowAdvance(flow, "ask_type", "nueva").nextKey).toBe("ask_reason");
  });

  it("falls through to defaultNext on an unmatched answer", () => {
    expect(flowAdvance(flow, "ask_type", "no sé").nextKey).toBe("ask_reason");
  });

  it("marks done when a step has no next", () => {
    expect(flowAdvance(flow, "ask_reason", "dolor").nextKey).toBe("done");
    expect(flowAdvance(flow, "done", "ok").done).toBe(true);
  });
});
