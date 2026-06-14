import type {
  Appointment,
  Conversation,
  KbEntry,
  Message,
  Patient,
  Session,
  User,
} from "@docmee/contracts";
import type {
  AutomationSettings,
  ChannelConnection,
  Clinic,
  Doctor,
  DocumentEntry,
  ExportJob,
  Flow,
  QuickReply,
  Template,
} from "../lib/api/contract-types";

/**
 * In-memory mock store. Mutable so create/send/mode-change reflect within a
 * session — replaced by real APIs at each phase's integration checkpoint.
 */
export const mockSession: Session = {
  user: { id: "usr_demo", name: "Dra. Ana Pérez", role: "admin" },
  clinicId: "cln_demo",
  role: "admin",
  locale: "es",
};

export const mockPatients: Patient[] = [
  {
    id: "pat_001",
    clinicId: "cln_demo",
    name: "María González",
    phone: "+502 5555 0001",
    status: "active",
    tags: ["nuevo"],
    channelIdentities: ["whatsapp:50255550001"],
    createdAt: "2026-06-01T14:00:00Z",
  },
  {
    id: "pat_002",
    clinicId: "cln_demo",
    name: "Carlos Ramírez",
    phone: "+502 5555 0002",
    status: "active",
    tags: [],
    channelIdentities: ["whatsapp:50255550002"],
    createdAt: "2026-06-03T09:30:00Z",
  },
];

export const mockConversations: Conversation[] = [
  {
    id: "cnv_001",
    patientId: "pat_001",
    channel: "whatsapp",
    mode: "bot",
    assigneeId: null,
    lastInteractionAt: "2026-06-14T12:10:00Z",
    windowExpiresAt: "2026-06-15T12:10:00Z",
  },
  {
    id: "cnv_002",
    patientId: "pat_002",
    channel: "whatsapp",
    mode: "human",
    assigneeId: "usr_demo",
    lastInteractionAt: "2026-06-14T11:40:00Z",
    windowExpiresAt: "2026-06-15T11:40:00Z",
  },
];

export const mockMessages: Message[] = [
  {
    id: "msg_001",
    conversationId: "cnv_001",
    direction: "inbound",
    author: "patient",
    body: "Hola, ¿tienen cita disponible esta semana?",
    providerMessageId: "wamid.001",
    createdAt: "2026-06-14T12:08:00Z",
  },
  {
    id: "msg_002",
    conversationId: "cnv_001",
    direction: "outbound",
    author: "bot",
    body: "¡Hola! Con gusto. Atendemos de lunes a viernes de 8:00 a 17:00. ¿Qué día le conviene?",
    providerMessageId: "wamid.002",
    createdAt: "2026-06-14T12:10:00Z",
  },
  {
    id: "msg_003",
    conversationId: "cnv_002",
    direction: "inbound",
    author: "patient",
    body: "Necesito reprogramar mi cita del jueves.",
    providerMessageId: "wamid.003",
    createdAt: "2026-06-14T11:38:00Z",
  },
  {
    id: "msg_004",
    conversationId: "cnv_002",
    direction: "outbound",
    author: "staff",
    body: "Claro, le ayudo con eso. ¿Para qué fecha desea moverla?",
    providerMessageId: "wamid.004",
    createdAt: "2026-06-14T11:40:00Z",
  },
];

export const mockAppointments: Appointment[] = [
  {
    id: "apt_001",
    patientId: "pat_001",
    doctorId: null,
    status: "confirmed",
    startAt: "2026-06-16T15:00:00Z",
    endAt: "2026-06-16T15:30:00Z",
  },
];

export const mockKbEntries: KbEntry[] = [
  {
    id: "kb_001",
    type: "manual",
    title: "Horario de atención",
    content: "Lunes a viernes de 8:00 a 17:00.",
    updatedAt: "2026-06-10T10:00:00Z",
  },
  {
    id: "kb_002",
    type: "rule",
    title: "Regla de seguridad médica",
    content: "El bot nunca diagnostica ni receta. Deriva a un humano.",
    updatedAt: "2026-06-10T10:00:00Z",
  },
];

// ===== Phase 2A–3D seeds =====
export const mockClinics: Clinic[] = [
  { id: "cln_demo", name: "Clínica San Rafael", status: "active" },
  { id: "cln_norte", name: "Centro Médico Norte", status: "active" },
];

export const mockUsers: User[] = [
  { id: "usr_demo", name: "Dra. Ana Pérez", role: "admin" },
  { id: "usr_sec", name: "Luis Morales", role: "secretary" },
  { id: "usr_doc", name: "Dr. Jorge Díaz", role: "doctor" },
];

export const mockQuickReplies: QuickReply[] = [
  { id: "qr_001", shortcut: "/horario", body: "Atendemos de lunes a viernes de 8:00 a 17:00." },
  { id: "qr_002", shortcut: "/ubicacion", body: "Estamos en la 5a avenida 12-34, zona 10." },
];

export const mockChannels: ChannelConnection[] = [
  { channel: "whatsapp", status: "connected", displayName: "Clínica San Rafael" },
  { channel: "messenger", status: "disconnected", displayName: null },
  { channel: "instagram", status: "disconnected", displayName: null },
];

export const mockTemplates: Template[] = [
  {
    id: "tpl_001",
    name: "recordatorio_cita",
    category: "utility",
    language: "es",
    body: "Hola {{1}}, le recordamos su cita el {{2}}.",
    status: "approved",
  },
];

export const mockAutomation: AutomationSettings = {
  remindersEnabled: true,
  reminderHoursBefore: 24,
  followUpsEnabled: false,
  quietHoursStart: "21:00",
  quietHoursEnd: "07:00",
};

export const mockDoctors: Doctor[] = [
  { id: "doc_001", name: "Dra. Ana Pérez", specialty: "Medicina general" },
  { id: "doc_002", name: "Dr. Jorge Díaz", specialty: "Pediatría" },
];

export const mockFlows: Flow[] = [
  {
    id: "flow_001",
    name: "Intake primera consulta",
    enabled: true,
    steps: [
      { id: "s1", prompt: "¿Cuál es el motivo de su consulta?", field: "reason" },
      { id: "s2", prompt: "¿Tiene seguro médico?", field: "insurance" },
    ],
  },
];

export const mockDocuments: DocumentEntry[] = [
  { id: "doc_a", filename: "indicaciones-postoperatorias.pdf", status: "ingested", createdAt: "2026-06-12T10:00:00Z" },
];

export const mockExports: ExportJob[] = [];

/** Monotonic id helper for mock writes (no Date.now/random needed). */
let seq = 100;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}`;
}
