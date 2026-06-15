import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@docmee/db/testing";
import { auth, integrations as integrationsDal, kb } from "@docmee/db";
import {
  LlmGateway,
  FakeChatProvider,
  FakeIntentProvider,
  FakeEmbeddingProvider,
} from "@docmee/llm";
import { FakeOcrProvider } from "@docmee/integrations";
import { ingestDocument } from "./documents.js";

const gateway = new LlmGateway({
  chat: new FakeChatProvider(),
  intent: new FakeIntentProvider(),
  embeddings: new FakeEmbeddingProvider(),
});

describe("document → KB ingestion (Phase 3C)", () => {
  let h: TestDb;
  let clinicId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => auth.createClinic(tx, { name: "A" }));
    clinicId = c.id;
  });
  afterAll(async () => h.close());

  it("OCRs (faked), chunks, embeds, and stores retrievable KB document_chunks", async () => {
    const ocr = new FakeOcrProvider(
      "El horario de atención es de lunes a viernes.\n\nEl parqueo es gratuito para pacientes.",
    );
    const doc = await h.db.withClinicContext(clinicId, (tx) =>
      integrationsDal.createDocument(tx, { filename: "info.pdf" }),
    );
    const result = await ingestDocument({ db: h.db, gateway, ocr }, {
      clinicId,
      documentId: doc.id,
    });
    // Short paragraphs merge under the 800-char budget → at least one chunk.
    expect(result.chunks).toBeGreaterThanOrEqual(1);

    // The ingested chunk is retrievable via the same grounded search the bot uses.
    const emb = await gateway.embedOne("parqueo gratuito");
    const hits = await h.db.withClinicContext(clinicId, (tx) =>
      kb.retrieve(tx, emb, { threshold: 0.2 }),
    );
    expect(hits.some((hh) => hh.content.includes("parqueo"))).toBe(true);
  });
});
