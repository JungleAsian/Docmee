import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@docmee/db/testing";
import {
  Keyring,
  auth,
  patients,
  conversations,
  automation,
  type OutboundTransport,
} from "@docmee/db";
import { runAutomationJob, type AutomationDeps } from "./automation.js";

const keyring = new Keyring({
  masterKeys: { 1: "autorun-test-master-key-aaaaaaaaaaaa" },
  hmacKey: "autorun-test-hmac-key-bbbbbbbbbbbbbbbb",
});

describe("🔒 automation runner — six gates end-to-end", () => {
  let h: TestDb;
  let clinicId: string;
  let sent: string[];
  let deps: AutomationDeps;
  let phoneSeq = 0;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => auth.createClinic(tx, { name: "A" }));
    clinicId = c.id;
    sent = [];
    const transport: OutboundTransport = {
      send: async (p) => {
        sent.push(p.content);
        return { providerMessageId: "x" + sent.length };
      },
    };
    deps = { db: h.db, keyring, transport };
  });
  afterAll(async () => h.close());

  async function seed(opts: { windowOpen?: boolean; optedOut?: boolean; consent?: boolean }) {
    const phone = `+5025500${String(++phoneSeq).padStart(4, "0")}`;
    return h.db.withClinicContext(clinicId, async (tx) => {
      const p = await patients.createPatient(tx, keyring, { phone });
      const cv = await conversations.getOrCreateConversation(tx, p.id, "whatsapp");
      if (opts.windowOpen) await conversations.markPatientInbound(tx, cv.id);
      if (opts.optedOut) await patients.setOptOut(tx, p.id, true);
      if (opts.consent) await automation.recordConsent(tx, { patientId: p.id, granted: true });
      return { patientId: p.id, conversationId: cv.id };
    });
  }

  async function enqueue(type: string, patientId: string, conversationId: string) {
    return h.db.withClinicContext(clinicId, async (tx) => {
      await automation.setAutomationRule(tx, type, true);
      const r = await automation.enqueueAutomation(tx, { patientId, conversationId, type });
      const { rows } = await tx.query<automation.AutomationJob>(
        `SELECT * FROM automation_queue WHERE id = $1`,
        [r.id],
      );
      return rows[0]!;
    });
  }

  it("sends when all six gates pass (window open, consent, enabled)", async () => {
    const { patientId, conversationId } = await seed({ windowOpen: true, consent: true });
    const job = await enqueue("reminder_1day", patientId, conversationId);
    const before = sent.length;
    const out = await runAutomationJob(deps, clinicId, job);
    expect(out.status).toBe("sent");
    expect(sent.length).toBe(before + 1);
  });

  it("skips an opted-out patient (gate 1)", async () => {
    const { patientId, conversationId } = await seed({ windowOpen: true, consent: true, optedOut: true });
    const job = await enqueue("reminder_1day", patientId, conversationId);
    expect((await runAutomationJob(deps, clinicId, job)).status).toBe("skipped");
  });

  it("skips without consent (gate 4)", async () => {
    const { patientId, conversationId } = await seed({ windowOpen: true, consent: false });
    const job = await enqueue("reminder_1day", patientId, conversationId);
    const out = await runAutomationJob(deps, clinicId, job);
    expect(out).toEqual({ status: "skipped", gate: "no_consent" });
  });

  it("requires an approved template outside the 24h window (gate 6)", async () => {
    const { patientId, conversationId } = await seed({ windowOpen: false, consent: true });
    const job = await enqueue("reminder_1day", patientId, conversationId);
    const out = await runAutomationJob(deps, clinicId, job);
    expect(out).toEqual({ status: "skipped", gate: "template_required" });
  });

  it("enforces the 48h frequency cap (gate 5)", async () => {
    const { patientId, conversationId } = await seed({ windowOpen: true, consent: true });
    const job1 = await enqueue("checkin_3month", patientId, conversationId);
    expect((await runAutomationJob(deps, clinicId, job1)).status).toBe("sent");
    // A second job of the same type for the same patient is capped.
    const job2 = await h.db.withClinicContext(clinicId, async (tx) => {
      const r = await automation.enqueueAutomation(tx, {
        patientId,
        conversationId,
        type: "checkin_3month",
      });
      const { rows } = await tx.query<automation.AutomationJob>(
        `SELECT * FROM automation_queue WHERE id = $1`,
        [r.id],
      );
      return rows[0]!;
    });
    expect(await runAutomationJob(deps, clinicId, job2)).toEqual({
      status: "skipped",
      gate: "frequency_cap",
    });
  });
});
