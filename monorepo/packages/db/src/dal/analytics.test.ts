import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/pglite.js";
import { Keyring } from "../crypto/keyring.js";
import { createClinic } from "./auth.js";
import { createPatient } from "./patients.js";
import { getOrCreateConversation } from "./conversations.js";
import { insertMessage } from "./messages.js";
import { createAppointment } from "./appointments.js";
import { writeAudit } from "./audit.js";
import { logError } from "./errors.js";
import {
  computeDailyRollup,
  getMetrics,
  listErrors,
  reviewError,
  createKbSuggestion,
  listKbSuggestions,
} from "./analytics.js";

const keyring = new Keyring({
  masterKeys: { 1: "an-test-master-key-aaaaaaaaaaaaaaaaaa" },
  hmacKey: "an-test-hmac-key-bbbbbbbbbbbbbbbbbbbbbb",
});

describe("analytics rollups & error review (Phase 2D)", () => {
  let h: TestDb;
  let clinicId: string;
  let day: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => createClinic(tx, { name: "A" }));
    clinicId = c.id;
    await h.db.withClinicContext(clinicId, async (tx) => {
      const p = await createPatient(tx, keyring, { phone: "+50255550001" });
      const cv = await getOrCreateConversation(tx, p.id, "whatsapp");
      await insertMessage(tx, keyring, {
        conversationId: cv.id,
        direction: "inbound",
        author: "patient",
        content: "Hola",
        providerMessageId: "w1",
      });
      await insertMessage(tx, keyring, {
        conversationId: cv.id,
        direction: "outbound",
        author: "bot",
        content: "Hola, ¿en qué ayudo?",
      });
      await createAppointment(tx, {
        patientId: p.id,
        startAt: "2026-12-01T15:00:00Z",
        endAt: "2026-12-01T15:30:00Z",
      });
      await writeAudit(tx, { action: "bot.handoff", target: cv.id });
      const { rows } = await tx.query<{ d: string }>(`SELECT current_date::text AS d`);
      day = rows[0]!.d;
    });
  });
  afterAll(async () => h.close());

  it("rolls up counts only (no PHI) and reads them back", async () => {
    await h.db.withClinicContext(clinicId, (tx) => computeDailyRollup(tx, day));
    const metrics = await h.db.withClinicContext(clinicId, (tx) =>
      getMetrics(tx, { from: day, to: day }),
    );
    const map = Object.fromEntries(metrics.map((m) => [m.metric_key, Number(m.value)]));
    expect(map.messages_in).toBe(1);
    expect(map.messages_out).toBe(1);
    expect(map.conversations_new).toBe(1);
    expect(map.appointments_booked).toBe(1);
    expect(map.handoffs).toBe(1);
  });

  it("is idempotent on re-run", async () => {
    await h.db.withClinicContext(clinicId, (tx) => computeDailyRollup(tx, day));
    const metrics = await h.db.withClinicContext(clinicId, (tx) =>
      getMetrics(tx, { from: day, to: day }),
    );
    expect(metrics.find((m) => m.metric_key === "messages_in")?.value).toBe(1);
  });

  it("error review: list → categorize/resolve, and KB suggestions", async () => {
    await h.db.withClinicContext(clinicId, (tx) =>
      logError(tx, "bot_unknown_intent", { note: "no match" }),
    );
    const open = await h.db.withClinicContext(clinicId, (tx) => listErrors(tx, { status: "open" }));
    expect(open.length).toBeGreaterThanOrEqual(1);

    await h.db.withClinicContext(clinicId, (tx) =>
      reviewError(tx, open[0]!.id, { category: "intent", status: "resolved" }),
    );
    const stillOpen = await h.db.withClinicContext(clinicId, (tx) =>
      listErrors(tx, { status: "open" }),
    );
    expect(stillOpen.find((e) => e.id === open[0]!.id)).toBeUndefined();

    await h.db.withClinicContext(clinicId, (tx) =>
      createKbSuggestion(tx, { question: "¿Tienen parqueo?", source: "error_review" }),
    );
    const suggestions = await h.db.withClinicContext(clinicId, (tx) => listKbSuggestions(tx));
    expect(suggestions[0]?.question).toBe("¿Tienen parqueo?");
  });
});
