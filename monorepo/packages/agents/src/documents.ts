import { kb, integrations as integrationsDal, type Database } from "@docmee/db";
import { chunkText } from "@docmee/core";
import type { OcrProvider } from "@docmee/integrations";
import type { LlmGateway } from "@docmee/llm";

/**
 * Document → KB ingestion (Phase 3C). OCR/extract → chunk → embed → store as
 * document_chunk KB entries (optionally doctor-scoped). The document feeds the
 * same grounded retrieval the bot already uses.
 */
export interface DocumentIngestDeps {
  db: Database;
  gateway: LlmGateway;
  ocr: OcrProvider;
}

export async function ingestDocument(
  deps: DocumentIngestDeps,
  input: {
    clinicId: string;
    documentId: string;
    text?: string;
    bytes?: ArrayBuffer;
    doctorId?: string;
  },
): Promise<{ chunks: number }> {
  const raw = input.text ?? (await deps.ocr.extractText(input.bytes ?? new ArrayBuffer(0)));
  const chunks = chunkText(raw);
  const embeddings = chunks.length ? await deps.gateway.embed(chunks) : [];

  await deps.db.withClinicContext(input.clinicId, async (tx) => {
    for (let i = 0; i < chunks.length; i++) {
      await kb.createKbEntry(tx, {
        type: "document_chunk",
        content: chunks[i]!,
        embedding: embeddings[i],
        source: input.documentId,
        doctorId: input.doctorId,
      });
    }
    await integrationsDal.markDocumentProcessed(tx, input.documentId, chunks.length);
  });

  return { chunks: chunks.length };
}
