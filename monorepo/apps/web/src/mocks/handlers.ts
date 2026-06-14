import type {
  Appointment,
  AppointmentCreate,
  Conversation,
  ConversationMode,
  KbEntry,
  KbEntryCreate,
  Message,
  MessageCreate,
  Patient,
  PatientCreate,
} from "@docmee/contracts";
import type { ApiError } from "@docmee/contracts";
import type {
  AutomationSettings,
  DoctorCreate,
  DocumentCreate,
  ExportJobCreate,
  FlowCreate,
  QuickReplyCreate,
  TemplateCreate,
  UserCreate,
} from "../lib/api/contract-types";
import { http, HttpResponse } from "msw";
import { API_BASE_URL as BASE } from "../config/env";
import {
  mockAppointments,
  mockAutomation,
  mockChannels,
  mockClinics,
  mockConversations,
  mockDoctors,
  mockDocuments,
  mockExports,
  mockFlows,
  mockKbEntries,
  mockMessages,
  mockPatients,
  mockQuickReplies,
  mockSession,
  mockTemplates,
  mockUsers,
  nextId,
} from "./data";

const unauthorized: ApiError = {
  error: { code: "unauthorized", message: "Missing or invalid token" },
};

const notFound: ApiError = { error: { code: "not_found", message: "Not found" } };

function requireAuth(request: Request): boolean {
  return Boolean(request.headers.get("Authorization")?.startsWith("Bearer "));
}

function nowIso(): string {
  return new Date().toISOString();
}

/** MSW handlers mirroring packages/contracts/openapi.yaml (Phase 0/1A surface). */
export const handlers = [
  http.get(`${BASE}/auth/session`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json(mockSession);
  }),

  // --- patients ---
  http.get(`${BASE}/patients`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase();
    const data = q
      ? mockPatients.filter(
          (p) =>
            p.name?.toLowerCase().includes(q) || p.phone?.toLowerCase().includes(q),
        )
      : mockPatients;
    return HttpResponse.json({ data, nextCursor: null });
  }),

  http.post(`${BASE}/patients`, async ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const body = (await request.json()) as PatientCreate;
    const patient: Patient = {
      id: nextId("pat"),
      clinicId: mockSession.clinicId,
      name: body.name,
      phone: body.phone ?? "",
      status: "active",
      tags: body.tags ?? [],
      channelIdentities: [],
      createdAt: nowIso(),
    };
    mockPatients.unshift(patient);
    return HttpResponse.json(patient, { status: 201 });
  }),

  http.get(`${BASE}/patients/:patientId`, ({ request, params }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const patient = mockPatients.find((p) => p.id === params.patientId);
    if (!patient) return HttpResponse.json(notFound, { status: 404 });
    return HttpResponse.json(patient);
  }),

  // --- conversations ---
  http.get(`${BASE}/conversations`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode");
    const channel = url.searchParams.get("channel");
    const data = mockConversations.filter(
      (c) => (!mode || c.mode === mode) && (!channel || c.channel === channel),
    );
    return HttpResponse.json({ data, nextCursor: null });
  }),

  http.put(`${BASE}/conversations/:conversationId/mode`, async ({ request, params }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const conv = mockConversations.find((c) => c.id === params.conversationId);
    if (!conv) return HttpResponse.json(notFound, { status: 404 });
    const body = (await request.json()) as { mode: ConversationMode };
    conv.mode = body.mode;
    conv.assigneeId = body.mode === "human" ? mockSession.user?.id ?? null : null;
    conv.lastInteractionAt = nowIso();
    return HttpResponse.json(conv satisfies Conversation);
  }),

  // --- messages ---
  http.get(`${BASE}/conversations/:conversationId/messages`, ({ request, params }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const data = mockMessages.filter((m) => m.conversationId === params.conversationId);
    return HttpResponse.json({ data, nextCursor: null });
  }),

  http.post(`${BASE}/conversations/:conversationId/messages`, async ({ request, params }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const conversationId = String(params.conversationId);
    const conv = mockConversations.find((c) => c.id === conversationId);
    if (!conv) return HttpResponse.json(notFound, { status: 404 });
    const body = (await request.json()) as MessageCreate;
    const message: Message = {
      id: nextId("msg"),
      conversationId,
      direction: "outbound",
      author: "staff",
      body: body.body,
      providerMessageId: nextId("wamid"),
      createdAt: nowIso(),
    };
    mockMessages.push(message);
    conv.lastInteractionAt = message.createdAt;
    // A staff reply pauses the bot (locked product rule).
    if (conv.mode === "bot") conv.mode = "human";
    return HttpResponse.json(message, { status: 202 });
  }),

  // --- appointments ---
  http.get(`${BASE}/appointments`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const url = new URL(request.url);
    const patientId = url.searchParams.get("patientId");
    const status = url.searchParams.get("status");
    const data = mockAppointments.filter(
      (a) => (!patientId || a.patientId === patientId) && (!status || a.status === status),
    );
    return HttpResponse.json({ data, nextCursor: null });
  }),

  http.post(`${BASE}/appointments`, async ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const body = (await request.json()) as AppointmentCreate;
    const start = new Date(body.startAt).getTime();
    const end = new Date(body.endAt).getTime();
    // Reject overlaps against existing non-cancelled appointments (Calendar truth stand-in).
    const conflict = mockAppointments.some((a) => {
      if (a.status === "cancelled") return false;
      const aStart = new Date(a.startAt ?? 0).getTime();
      const aEnd = new Date(a.endAt ?? 0).getTime();
      return start < aEnd && end > aStart;
    });
    if (conflict) {
      return HttpResponse.json(
        { error: { code: "slot_conflict", message: "Slot already booked" } },
        { status: 409 },
      );
    }
    const appointment: Appointment = {
      id: nextId("apt"),
      patientId: body.patientId,
      doctorId: body.doctorId ?? null,
      status: "booked",
      startAt: body.startAt,
      endAt: body.endAt,
    };
    mockAppointments.push(appointment);
    return HttpResponse.json(appointment, { status: 201 });
  }),

  // --- knowledge base ---
  http.get(`${BASE}/kb/entries`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json({ data: mockKbEntries, nextCursor: null });
  }),

  http.post(`${BASE}/kb/entries`, async ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const body = (await request.json()) as KbEntryCreate;
    const entry: KbEntry = {
      id: nextId("kb"),
      type: body.type,
      title: body.title ?? "",
      content: body.content,
      updatedAt: nowIso(),
    };
    mockKbEntries.unshift(entry);
    return HttpResponse.json(entry, { status: 201 });
  }),

  // ===== Phase 2A — multi-user / RBAC / IA Studio =====
  http.get(`${BASE}/clinics`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json({ data: mockClinics, nextCursor: null });
  }),
  http.get(`${BASE}/users`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json({ data: mockUsers, nextCursor: null });
  }),
  http.post(`${BASE}/users`, async ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const body = (await request.json()) as UserCreate;
    const user = { id: nextId("usr"), name: body.name, role: body.role };
    mockUsers.push(user);
    return HttpResponse.json(user, { status: 201 });
  }),
  http.put(`${BASE}/users/:userId/role`, async ({ request, params }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const user = mockUsers.find((u) => u.id === params.userId);
    if (!user) return HttpResponse.json(notFound, { status: 404 });
    const body = (await request.json()) as { role: NonNullable<typeof user.role> };
    user.role = body.role;
    return HttpResponse.json(user);
  }),
  http.get(`${BASE}/quick-replies`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json({ data: mockQuickReplies, nextCursor: null });
  }),
  http.post(`${BASE}/quick-replies`, async ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const body = (await request.json()) as QuickReplyCreate;
    const qr = { id: nextId("qr"), shortcut: body.shortcut, body: body.body };
    mockQuickReplies.push(qr);
    return HttpResponse.json(qr, { status: 201 });
  }),

  // ===== Phase 2B — channels =====
  http.get(`${BASE}/channels`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json({ data: mockChannels, nextCursor: null });
  }),
  http.post(`${BASE}/channels/:channel/connect`, ({ request, params }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const conn = mockChannels.find((c) => c.channel === params.channel);
    if (!conn) return HttpResponse.json(notFound, { status: 404 });
    conn.status = "connected";
    conn.displayName = mockClinics[0]?.name ?? "Clínica";
    return HttpResponse.json(conn);
  }),

  // ===== Phase 2C — templates & automation =====
  http.get(`${BASE}/templates`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json({ data: mockTemplates, nextCursor: null });
  }),
  http.post(`${BASE}/templates`, async ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const body = (await request.json()) as TemplateCreate;
    const tpl = {
      id: nextId("tpl"),
      name: body.name,
      category: body.category,
      language: body.language ?? "es",
      body: body.body,
      status: "draft" as const,
    };
    mockTemplates.unshift(tpl);
    return HttpResponse.json(tpl, { status: 201 });
  }),
  http.post(`${BASE}/templates/:templateId/submit`, ({ request, params }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const tpl = mockTemplates.find((t) => t.id === params.templateId);
    if (!tpl) return HttpResponse.json(notFound, { status: 404 });
    tpl.status = "pending";
    return HttpResponse.json(tpl);
  }),
  http.get(`${BASE}/automation/settings`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json(mockAutomation);
  }),
  http.put(`${BASE}/automation/settings`, async ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const body = (await request.json()) as AutomationSettings;
    Object.assign(mockAutomation, body);
    return HttpResponse.json(mockAutomation);
  }),

  // ===== Phase 2D — analytics & search =====
  http.get(`${BASE}/analytics/overview`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json({
      conversations7d: 128,
      bookings7d: 37,
      deflectionRate: 0.72,
      avgResponseSeconds: 45,
      series: [
        { date: "2026-06-08", conversations: 14, bookings: 4 },
        { date: "2026-06-09", conversations: 22, bookings: 7 },
        { date: "2026-06-10", conversations: 18, bookings: 5 },
        { date: "2026-06-11", conversations: 25, bookings: 6 },
        { date: "2026-06-12", conversations: 17, bookings: 4 },
        { date: "2026-06-13", conversations: 16, bookings: 6 },
        { date: "2026-06-14", conversations: 16, bookings: 5 },
      ],
    });
  }),
  http.get(`${BASE}/messages/search`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
    const data = q ? mockMessages.filter((m) => m.body?.toLowerCase().includes(q)) : [];
    return HttpResponse.json({ data, nextCursor: null });
  }),

  // ===== Phase 3A — doctors =====
  http.get(`${BASE}/doctors`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json({ data: mockDoctors, nextCursor: null });
  }),
  http.post(`${BASE}/doctors`, async ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const body = (await request.json()) as DoctorCreate;
    const doc = { id: nextId("doc"), name: body.name, specialty: body.specialty ?? "" };
    mockDoctors.push(doc);
    return HttpResponse.json(doc, { status: 201 });
  }),

  // ===== Phase 3B — flows & copilot =====
  http.get(`${BASE}/flows`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json({ data: mockFlows, nextCursor: null });
  }),
  http.post(`${BASE}/flows`, async ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const body = (await request.json()) as FlowCreate;
    const flow = { id: nextId("flow"), name: body.name, enabled: body.enabled ?? false, steps: [] };
    mockFlows.unshift(flow);
    return HttpResponse.json(flow, { status: 201 });
  }),
  http.post(`${BASE}/copilot/suggest`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json({
      suggestion:
        "Con gusto le ayudo. Tenemos disponibilidad esta semana; ¿qué día le conviene para agendar?",
      confidence: 0.82,
    });
  }),

  // ===== Phase 3C — documents & exports =====
  http.get(`${BASE}/documents`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json({ data: mockDocuments, nextCursor: null });
  }),
  http.post(`${BASE}/documents`, async ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const body = (await request.json()) as DocumentCreate;
    const doc = { id: nextId("docu"), filename: body.filename, status: "processing" as const, createdAt: nowIso() };
    mockDocuments.unshift(doc);
    return HttpResponse.json(doc, { status: 201 });
  }),
  http.get(`${BASE}/exports`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json({ data: mockExports, nextCursor: null });
  }),
  http.post(`${BASE}/exports`, async ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    const body = (await request.json()) as ExportJobCreate;
    const job = {
      id: nextId("exp"),
      target: body.target,
      status: "pending" as const,
      consent: body.consent,
      createdAt: nowIso(),
    };
    mockExports.unshift(job);
    return HttpResponse.json(job, { status: 201 });
  }),

  // ===== Phase 3D — push =====
  http.post(`${BASE}/push/subscribe`, ({ request }) => {
    if (!requireAuth(request)) return HttpResponse.json(unauthorized, { status: 401 });
    return HttpResponse.json({ id: nextId("push"), active: true }, { status: 201 });
  }),
];
