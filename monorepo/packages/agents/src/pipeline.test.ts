import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@docmee/db/testing";
import {
  Keyring,
  auth,
  patients,
  conversations,
  kb,
  appointments,
  type OutboundTransport,
} from "@docmee/db";
import {
  LlmGateway,
  FakeChatProvider,
  FakeIntentProvider,
  FakeEmbeddingProvider,
} from "@docmee/llm";
import { processTurn, type PipelineDeps } from "./pipeline.js";

const keyring = new Keyring({
  masterKeys: { 1: "agents-test-master-key-aaaaaaaaaaaa" },
  hmacKey: "agents-test-hmac-key-bbbbbbbbbbbbbbbb",
});
const gateway = new LlmGateway({
  chat: new FakeChatProvider(),
  intent: new FakeIntentProvider(),
  embeddings: new FakeEmbeddingProvider(),
});

const QUESTION = "¿Cuál es el horario de atención de la clínica?";

describe("Phase 1A — conversation pipeline", () => {
  let h: TestDb;
  let clinicId: string;
  let patientId: string;
  let conversationId: string;
  let sent: string[];
  let deps: PipelineDeps;

  beforeAll(async () => {
    h = await createTestDb();
    const clinic = await h.db.withPlatformContext((tx) =>
      auth.createClinic(tx, { name: "Clinic A", whatsappPhoneNumberId: "pn_A" }),
    );
    clinicId = clinic.id;

    // Seed a rule + a KB entry whose embedding matches the question (cosine 1.0).
    const qEmbedding = await gateway.embedOne(QUESTION);
    await h.db.withClinicContext(clinicId, async (tx) => {
      await kb.createKbEntry(tx, { type: "rule", content: "Sé amable y profesional." });
      await kb.createKbEntry(tx, {
        type: "manual",
        title: "Horario",
        content: "Atendemos de lunes a viernes, de 8:00 a 17:00.",
        embedding: qEmbedding,
      });
      const p = await patients.createPatient(tx, keyring, { phone: "+50255550001" });
      const c = await conversations.getOrCreateConversation(tx, p.id, "whatsapp");
      patientId = p.id;
      conversationId = c.id;
    });
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    sent = [];
    const transport: OutboundTransport = {
      send: async (p) => {
        sent.push(p.content);
        return { providerMessageId: "out_" + sent.length };
      },
    };
    deps = { db: h.db, gateway, keyring, transport };
    // reset conversation to bot mode + clear opt-out between cases
    await h.db.withClinicContext(clinicId, async (tx) => {
      await conversations.handBackToBot(tx, conversationId);
      await patients.setOptOut(tx, patientId, false);
    });
  });

  it("answers a grounded question and delivers via the chokepoint", async () => {
    const res = await processTurn(deps, {
      clinicId,
      conversationId,
      patientId,
      text: QUESTION,
    });
    expect(res.action).toBe("replied");
    expect(sent).toHaveLength(1);
  });

  it("hands off (no hallucination) when KB is below the 0.70 threshold", async () => {
    const res = await processTurn(deps, {
      clinicId,
      conversationId,
      patientId,
      text: "zxqw plugh foobar unrelated gibberish",
    });
    expect(res.action).toBe("gap");
    // conversation handed to a human
    const conv = await h.db.withClinicContext(clinicId, (tx) =>
      conversations.getConversation(tx, conversationId),
    );
    expect(conv?.mode).toBe("human");
  });

  it("escalates an explicit handoff request", async () => {
    const res = await processTurn(deps, {
      clinicId,
      conversationId,
      patientId,
      text: "Quiero hablar con una persona",
    });
    expect(res.action).toBe("handoff");
  });

  it("NEVER interrupts a human (skips when mode is not bot)", async () => {
    await h.db.withClinicContext(clinicId, (tx) =>
      conversations.pauseForHuman(tx, conversationId),
    );
    const res = await processTurn(deps, {
      clinicId,
      conversationId,
      patientId,
      text: QUESTION,
    });
    expect(res).toEqual({ action: "skipped", reason: "not_bot_mode" });
    expect(sent).toHaveLength(0);
  });

  it("is suppressed for an opted-out patient (chokepoint)", async () => {
    await h.db.withClinicContext(clinicId, (tx) =>
      patients.setOptOut(tx, patientId, true),
    );
    const res = await processTurn(deps, {
      clinicId,
      conversationId,
      patientId,
      text: QUESTION,
    });
    expect(res.action).toBe("suppressed");
    expect(sent).toHaveLength(0);
  });

  it("answers an appointment-status query from the patient's upcoming appointment", async () => {
    await h.db.withClinicContext(clinicId, (tx) =>
      appointments.createAppointment(tx, {
        patientId,
        startAt: "2026-12-01T15:00:00Z",
        endAt: "2026-12-01T15:30:00Z",
      }),
    );
    const res = await processTurn(deps, {
      clinicId,
      conversationId,
      patientId,
      text: "¿Cuándo es mi cita?",
    });
    expect(res.action).toBe("replied");
    expect(sent[0]).toContain("2026-12-01");
  });

  it("starts and advances the booking intake on a booking request", async () => {
    // Own conversation so intake state doesn't leak into other cases.
    const ids = await h.db.withClinicContext(clinicId, async (tx) => {
      const p = await patients.createPatient(tx, keyring, { phone: "+50255550777" });
      const c = await conversations.getOrCreateConversation(tx, p.id, "whatsapp");
      return { patientId: p.id, conversationId: c.id };
    });

    const start = await processTurn(deps, {
      clinicId,
      conversationId: ids.conversationId,
      patientId: ids.patientId,
      text: "Quiero agendar una cita",
    });
    expect(start.action).toBe("replied"); // first intake prompt sent

    const next = await processTurn(deps, {
      clinicId,
      conversationId: ids.conversationId,
      patientId: ids.patientId,
      text: "Consulta general",
    });
    expect(next.action).toBe("intake"); // treated as the intake's next answer
  });
});
