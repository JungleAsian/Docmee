import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@docmee/core";
import {
  patients,
  conversations,
  messages as messagesDal,
  notes as notesDal,
  notifications as notificationsDal,
  audit as auditDal,
  appointments as appointmentsDal,
  ops as opsDal,
  features as featuresDal,
  patientChannels as patientChannelsDal,
  automation as automationDal,
  analytics as analyticsDal,
  InvalidTransitionError,
  sendOutbound,
  type Database,
  type Keyring,
  type OutboundTransport,
} from "@docmee/db";
import { bookAppointment } from "@docmee/agents";
import type { CalendarProvider } from "@docmee/integrations";
import { clinicIdOf, actorIdOf, requireRole, INBOX_WRITERS } from "../plugins/rbac.js";

export interface PanelRouteOptions {
  db: Database;
  keyring: Keyring;
  transport: OutboundTransport;
  calendar: CalendarProvider;
}

const patientCreate = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(3).optional(),
  tags: z.array(z.string()).optional(),
});
const noteCreate = z.object({ body: z.string().min(1) });
const messageCreate = z.object({ body: z.string().min(1) });
const modeBody = z.object({ mode: z.enum(["bot", "human", "paused", "resolved"]) });
const assigneeBody = z.object({ assigneeId: z.string().uuid().nullable() });
const appointmentCreate = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid().optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  summary: z.string().min(1).optional(),
});
const statusBody = z.object({
  status: z.enum(["booked", "confirmed", "completed", "cancelled", "no_show"]),
});

/**
 * Panel REST API (Phase 1B). Every handler is clinic-scoped via the session's
 * clinicId through withClinicContext (RLS) — clinic_id is never read from the client.
 */
export async function panelRoutes(
  app: FastifyInstance,
  opts: PanelRouteOptions,
): Promise<void> {
  const { db, keyring, transport, calendar } = opts;
  const auth = app.authenticate;
  const writer = requireRole(...INBOX_WRITERS);

  // ── Patients ────────────────────────────────────────────────────────────────
  app.get("/patients", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const q = request.query as { q?: string; cursor?: string; limit?: string };
    return db.withClinicContext(clinicId, (tx) =>
      patients.listPatients(tx, keyring, {
        q: q.q,
        cursor: q.cursor,
        limit: q.limit ? Number(q.limit) : undefined,
      }),
    );
  });

  app.post("/patients", { preHandler: [auth, writer] }, async (request, reply) => {
    const clinicId = clinicIdOf(request);
    const parsed = patientCreate.safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    const created = await db.withClinicContext(clinicId, (tx) =>
      patients.createPatient(tx, keyring, parsed.data),
    );
    reply.code(201);
    return created;
  });

  app.get("/patients/:id", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { id } = request.params as { id: string };
    const result = await db.withClinicContext(clinicId, async (tx) => {
      const patient = await patients.getPatientById(tx, keyring, id);
      if (!patient) return null;
      const patientNotes = await notesDal.listPatientNotes(tx, id);
      return { ...patient, notes: patientNotes };
    });
    if (!result) throw new NotFoundError();
    return result;
  });

  app.get("/patients/:id/notes", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { id } = request.params as { id: string };
    return db.withClinicContext(clinicId, (tx) => notesDal.listPatientNotes(tx, id));
  });

  app.post("/patients/:id/notes", { preHandler: [auth, writer] }, async (request, reply) => {
    const clinicId = clinicIdOf(request);
    const { id } = request.params as { id: string };
    const parsed = noteCreate.safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    const note = await db.withClinicContext(clinicId, (tx) =>
      notesDal.addPatientNote(tx, {
        patientId: id,
        authorId: actorIdOf(request),
        body: parsed.data.body,
      }),
    );
    reply.code(201);
    return note;
  });

  // Manual cross-channel merge (Phase 2B).
  app.post("/patients/:id/merge", { preHandler: [auth, writer] }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ secondaryId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    await db.withClinicContext(clinicId, (tx) =>
      patientChannelsDal.mergePatients(tx, id, parsed.data.secondaryId),
    );
    return { ok: true };
  });

  // ── Conversations / inbox ─────────────────────────────────────────────────────
  app.get("/conversations", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const q = request.query as {
      mode?: string;
      channel?: string;
      assigneeId?: string;
    };
    const data = await db.withClinicContext(clinicId, (tx) =>
      conversations.listConversations(tx, q),
    );
    return { data, nextCursor: null };
  });

  app.get("/conversations/:id/messages", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { id } = request.params as { id: string };
    const data = await db.withClinicContext(clinicId, (tx) =>
      messagesDal.listMessages(tx, keyring, id),
    );
    return { data, nextCursor: null };
  });

  // Staff send: a human reply PAUSES the bot, then goes through the chokepoint.
  app.post(
    "/conversations/:id/messages",
    { preHandler: [auth, writer] },
    async (request, reply) => {
      const clinicId = clinicIdOf(request);
      const { id } = request.params as { id: string };
      const parsed = messageCreate.safeParse(request.body);
      if (!parsed.success) throw new ValidationError();

      const conv = await db.withClinicContext(clinicId, async (tx) => {
        const c = await conversations.getConversation(tx, id);
        if (c) await conversations.pauseForHuman(tx, id); // bot stops auto-replying
        return c;
      });
      if (!conv) throw new NotFoundError();

      const sent = await sendOutbound(db, keyring, transport, {
        clinicId,
        conversationId: id,
        patientId: conv.patient_id,
        author: "staff",
        content: parsed.data.body,
      });
      reply.code(sent.status === "sent" ? 202 : 409);
      return sent;
    },
  );

  app.put("/conversations/:id/mode", { preHandler: [auth, writer] }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { id } = request.params as { id: string };
    const parsed = modeBody.safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    const updated = await db.withClinicContext(clinicId, (tx) =>
      conversations.setMode(tx, id, parsed.data.mode),
    );
    if (!updated) throw new NotFoundError();
    return updated;
  });

  app.put(
    "/conversations/:id/assignee",
    { preHandler: [auth, writer] },
    async (request) => {
      const clinicId = clinicIdOf(request);
      const { id } = request.params as { id: string };
      const parsed = assigneeBody.safeParse(request.body);
      if (!parsed.success) throw new ValidationError();
      const updated = await db.withClinicContext(clinicId, (tx) =>
        conversations.assignConversation(tx, id, parsed.data.assigneeId),
      );
      if (!updated) throw new NotFoundError();
      return updated;
    },
  );

  // ── Appointments (Phase 1C) ───────────────────────────────────────────────────
  app.get("/appointments", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const q = request.query as { patientId?: string; status?: appointmentsDal.AppointmentStatus };
    const data = await db.withClinicContext(clinicId, (tx) =>
      appointmentsDal.listAppointments(tx, { patientId: q.patientId, status: q.status }),
    );
    return { data, nextCursor: null };
  });

  // Book against Calendar free/busy (source of truth) — 409 on slot conflict.
  app.post("/appointments", { preHandler: [auth, writer] }, async (request, reply) => {
    const clinicId = clinicIdOf(request);
    const parsed = appointmentCreate.safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    const result = await bookAppointment(
      { db, calendar },
      {
        clinicId,
        patientId: parsed.data.patientId,
        doctorId: parsed.data.doctorId ?? null,
        startAt: parsed.data.startAt,
        endAt: parsed.data.endAt,
        summary: parsed.data.summary ?? "Cita",
      },
    );
    if (result.status === "conflict") {
      reply.code(409);
      return { error: { code: "conflict", message: "Slot conflict" } };
    }
    reply.code(201);
    return result.appointment;
  });

  app.put("/appointments/:id/status", { preHandler: [auth, writer] }, async (request, reply) => {
    const clinicId = clinicIdOf(request);
    const { id } = request.params as { id: string };
    const parsed = statusBody.safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    try {
      return await db.withClinicContext(clinicId, (tx) =>
        appointmentsDal.transitionStatus(tx, id, parsed.data.status, actorIdOf(request)),
      );
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        reply.code(422);
        return { error: { code: "invalid_transition", message: err.message } };
      }
      throw err;
    }
  });

  // ── Quick replies (Phase 2A) ──────────────────────────────────────────────────
  app.get("/quick-replies", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const data = await db.withClinicContext(clinicId, (tx) => opsDal.listQuickReplies(tx));
    return { data };
  });

  app.post("/quick-replies", { preHandler: [auth, writer] }, async (request, reply) => {
    const clinicId = clinicIdOf(request);
    const parsed = z
      .object({ shortcut: z.string().min(1), body: z.string().min(1) })
      .safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    const created = await db.withClinicContext(clinicId, (tx) =>
      opsDal.createQuickReply(tx, parsed.data),
    );
    reply.code(201);
    return created;
  });

  app.delete("/quick-replies/:id", { preHandler: [auth, writer] }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { id } = request.params as { id: string };
    await db.withClinicContext(clinicId, (tx) => opsDal.deleteQuickReply(tx, id));
    return { ok: true };
  });

  // ── Feature gating (3-gate) ─────────────────────────────────────────────────
  app.get("/features/:key", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { key } = request.params as { key: string };
    return db.withClinicContext(clinicId, (tx) => featuresDal.evaluateFeature(tx, key));
  });

  app.put("/features/:key/toggle", { preHandler: [auth, requireRole("admin")] }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { key } = request.params as { key: string };
    const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    await db.withClinicContext(clinicId, (tx) =>
      featuresDal.setClinicToggle(tx, key, parsed.data.enabled),
    );
    return { ok: true };
  });

  // ── Manual invoicing (Phase 2A) ───────────────────────────────────────────────
  app.get("/invoices", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const data = await db.withClinicContext(clinicId, (tx) => opsDal.listInvoices(tx));
    return { data };
  });

  app.post("/invoices", { preHandler: [auth, requireRole("admin")] }, async (request, reply) => {
    const clinicId = clinicIdOf(request);
    const parsed = z
      .object({
        periodStart: z.string(),
        periodEnd: z.string(),
        amountCents: z.number().int().nonnegative(),
      })
      .safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    const created = await db.withClinicContext(clinicId, (tx) =>
      opsDal.createInvoice(tx, parsed.data),
    );
    reply.code(201);
    return created;
  });

  app.put("/invoices/:id/status", { preHandler: [auth, requireRole("admin")] }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ status: z.enum(["draft", "sent", "paid", "void"]) })
      .safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    const updated = await db.withClinicContext(clinicId, (tx) =>
      opsDal.setInvoiceStatus(tx, id, parsed.data.status),
    );
    if (!updated) throw new NotFoundError();
    return updated;
  });

  // ── Templates & automation (Phase 2C) ─────────────────────────────────────────
  app.post("/templates", { preHandler: [auth, requireRole("admin")] }, async (request, reply) => {
    const clinicId = clinicIdOf(request);
    const parsed = z
      .object({
        name: z.string().min(1),
        body: z.string().min(1),
        language: z.string().optional(),
        category: z.string().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    const created = await db.withClinicContext(clinicId, (tx) =>
      automationDal.createTemplate(tx, parsed.data),
    );
    reply.code(201);
    return created;
  });

  app.put("/templates/:id/status", { preHandler: [auth, requireRole("admin")] }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ status: z.enum(["pending", "approved", "rejected"]) })
      .safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    await db.withClinicContext(clinicId, (tx) =>
      automationDal.setTemplateStatus(tx, id, parsed.data.status),
    );
    return { ok: true };
  });

  app.put("/automation/:type", { preHandler: [auth, requireRole("admin")] }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { type } = request.params as { type: string };
    const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    await db.withClinicContext(clinicId, (tx) =>
      automationDal.setAutomationRule(tx, type, parsed.data.enabled),
    );
    return { ok: true };
  });

  app.post("/patients/:id/consent", { preHandler: [auth, writer] }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ granted: z.boolean(), scope: z.string().optional(), source: z.string().optional() })
      .safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    await db.withClinicContext(clinicId, (tx) =>
      automationDal.recordConsent(tx, { patientId: id, ...parsed.data }),
    );
    return { ok: true };
  });

  // ── Message search (Phase 2D, Q3) — per-clinic, audited ───────────────────────
  app.get("/search/messages", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const q = (request.query as { q?: string }).q;
    const parsed = z.string().min(1).safeParse(q);
    if (!parsed.success) throw new ValidationError();
    return db.withClinicContext(clinicId, async (tx) => {
      const data = await messagesDal.searchMessages(tx, keyring, parsed.data);
      await auditDal.writeAudit(tx, {
        action: "message.search",
        actorClinicUserId: actorIdOf(request),
        detail: { resultCount: data.length },
      });
      return { data, nextCursor: null };
    });
  });

  // ── Analytics & error review (Phase 2D) ───────────────────────────────────────
  app.get("/metrics", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const q = request.query as { from?: string; to?: string };
    const parsed = z
      .object({ from: z.string(), to: z.string() })
      .safeParse({ from: q.from, to: q.to });
    if (!parsed.success) throw new ValidationError();
    const data = await db.withClinicContext(clinicId, (tx) =>
      analyticsDal.getMetrics(tx, parsed.data),
    );
    return { data };
  });

  // Ops trigger for a day's rollup (the worker runs this on a schedule).
  app.post("/metrics/rollup", { preHandler: [auth, requireRole("admin")] }, async (request) => {
    const clinicId = clinicIdOf(request);
    const parsed = z.object({ day: z.string() }).safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    await db.withClinicContext(clinicId, (tx) =>
      analyticsDal.computeDailyRollup(tx, parsed.data.day),
    );
    return { ok: true };
  });

  app.get("/errors", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const q = request.query as { status?: string };
    const data = await db.withClinicContext(clinicId, (tx) =>
      analyticsDal.listErrors(tx, { status: q.status }),
    );
    return { data };
  });

  app.put("/errors/:id", { preHandler: [auth, writer] }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        category: z.string().optional(),
        status: z.enum(["open", "resolved", "kb_suggested"]).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    await db.withClinicContext(clinicId, (tx) => analyticsDal.reviewError(tx, id, parsed.data));
    return { ok: true };
  });

  app.get("/kb-suggestions", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const data = await db.withClinicContext(clinicId, (tx) =>
      analyticsDal.listKbSuggestions(tx),
    );
    return { data };
  });

  // ── Notifications ─────────────────────────────────────────────────────────────
  app.get("/notifications", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const q = request.query as { unread?: string };
    const data = await db.withClinicContext(clinicId, (tx) =>
      notificationsDal.listNotifications(tx, { unreadOnly: q.unread === "true" }),
    );
    return { data };
  });

  app.put("/notifications/:id/read", { preHandler: auth }, async (request) => {
    const clinicId = clinicIdOf(request);
    const { id } = request.params as { id: string };
    await db.withClinicContext(clinicId, (tx) => notificationsDal.markRead(tx, id));
    return { ok: true };
  });
}
