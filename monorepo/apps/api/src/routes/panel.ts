import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@docmee/core";
import {
  patients,
  conversations,
  messages as messagesDal,
  notes as notesDal,
  notifications as notificationsDal,
  sendOutbound,
  type Database,
  type Keyring,
  type OutboundTransport,
} from "@docmee/db";
import { clinicIdOf, actorIdOf, requireRole, INBOX_WRITERS } from "../plugins/rbac.js";

export interface PanelRouteOptions {
  db: Database;
  keyring: Keyring;
  transport: OutboundTransport;
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

/**
 * Panel REST API (Phase 1B). Every handler is clinic-scoped via the session's
 * clinicId through withClinicContext (RLS) — clinic_id is never read from the client.
 */
export async function panelRoutes(
  app: FastifyInstance,
  opts: PanelRouteOptions,
): Promise<void> {
  const { db, keyring, transport } = opts;
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
