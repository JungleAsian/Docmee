import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@docmee/db/testing";
import { auth, kb } from "@docmee/db";
import {
  LlmGateway,
  FakeChatProvider,
  FakeIntentProvider,
  FakeEmbeddingProvider,
} from "@docmee/llm";
import { suggestReply } from "./copilot.js";

const gateway = new LlmGateway({
  chat: new FakeChatProvider(),
  intent: new FakeIntentProvider(),
  embeddings: new FakeEmbeddingProvider(),
});

const Q = "¿Cuál es el horario de la clínica?";

describe("secretary copilot (Phase 3B)", () => {
  let h: TestDb;
  let clinicId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => auth.createClinic(tx, { name: "A" }));
    clinicId = c.id;
    const emb = await gateway.embedOne(Q);
    await h.db.withClinicContext(clinicId, (tx) =>
      kb.createKbEntry(tx, { type: "manual", content: "Atendemos 8-17h.", embedding: emb }),
    );
  });
  afterAll(async () => h.close());

  it("drafts a grounded reply for human review (does not send)", async () => {
    const s = await suggestReply({ db: h.db, gateway }, { clinicId, patientText: Q });
    expect(s.draft.length).toBeGreaterThan(0);
    expect(s.grounded).toBe(true);
    expect(s.sources).toContain("Atendemos 8-17h.");
  });

  it("flags low grounding when KB has no match", async () => {
    const s = await suggestReply(
      { db: h.db, gateway },
      { clinicId, patientText: "zxqw plugh unrelated" },
    );
    expect(s.grounded).toBe(false);
  });
});
