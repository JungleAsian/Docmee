export interface LocalizedProductText {
  en: string
  es: string
}

export type ProductAudience = 'all' | 'admin' | 'platform'

export interface ProductUpdate {
  id: string
  publishedAt: string
  version?: string
  audience: ProductAudience
  title: LocalizedProductText
  summary: LocalizedProductText
  highlights: LocalizedProductText[]
}

export interface ProductFeature {
  id: string
  category: LocalizedProductText
  title: LocalizedProductText
  description: LocalizedProductText
  href: string
  audience: ProductAudience
}

export const PRODUCT_UPDATES: ProductUpdate[] = [
  {
    id: '2026-09-25-jzel-teaching',
    publishedAt: '2026-09-25T00:00:00.000Z',
    version: '2026.09.25',
    audience: 'admin',
    title: { en: 'Teach your agent from the assistant', es: 'Enseña a tu agente desde el asistente' },
    summary: {
      en: 'Prepare and approve clinic knowledge in Teach the agent, then preview a workflow answer without sending a message.',
      es: 'Prepara y aprueba información de la clínica en Enseñar al agente y prueba una respuesta del flujo sin enviar mensajes.',
    },
    highlights: [
      { en: 'Choose the clinic, doctor and language. Review the exact entry and related knowledge before confirming.', es: 'Elige la clínica, el médico y el idioma. Revisa la entrada exacta y la información relacionada antes de confirmar.' },
      { en: 'Track draft, approval and indexing status, reopen recent lessons, and restore earlier approved content.', es: 'Consulta el estado del borrador, la aprobación y la indexación; abre lecciones recientes y restaura contenido aprobado anteriormente.' },
      { en: 'Test a saved workflow AI node against approved knowledge. The preview reports an answer or handoff without contacting patients.', es: 'Prueba un nodo de IA guardado con información aprobada. La vista previa muestra una respuesta o derivación sin contactar a pacientes.' },
    ],
  },
  {
    id: '2026-09-24-product-updates-center',
    publishedAt: '2026-09-24T12:00:00.000Z',
    version: '2026.09.24',
    audience: 'all',
    title: {
      en: 'Product updates are now easier to find',
      es: 'Ahora es mas facil encontrar las novedades',
    },
    summary: {
      en: 'Find release notes, new-update notifications, and a guide to your available features in one place.',
      es: 'Encuentra notas de versión, avisos de novedades y una guía de tus funciones disponibles en un solo lugar.',
    },
    highlights: [
      {
        en: 'A new header icon shows when product updates are available.',
        es: 'Un nuevo icono en el encabezado muestra cuando hay novedades disponibles.',
      },
      {
        en: 'The What’s New view keeps release notes together in chronological order.',
        es: 'La vista de novedades organiza las notas de version en orden cronologico.',
      },
      {
        en: 'The All Features view provides a role-aware guide to Docmee.',
        es: 'La vista de todas las funciones ofrece una guia de Docmee segun tu rol.',
      },
    ],
  },
]

export const PRODUCT_FEATURES: ProductFeature[] = [
  {
    id: 'inbox',
    category: { en: 'Patient communication', es: 'Comunicacion con pacientes' },
    title: { en: 'Unified inbox', es: 'Bandeja unificada' },
    description: {
      en: 'Manage patient conversations and handoffs in one workspace.',
      es: 'Gestiona conversaciones y transferencias de pacientes en un solo espacio.',
    },
    href: '/inbox',
    audience: 'all',
  },
  {
    id: 'calendar',
    category: { en: 'Appointments', es: 'Citas' },
    title: { en: 'Calendar and bookings', es: 'Calendario y reservas' },
    description: {
      en: 'Review availability, appointments, cancellations, and booking revisions.',
      es: 'Revisa disponibilidad, citas, cancelaciones y cambios de reserva.',
    },
    href: '/calendar',
    audience: 'all',
  },
  {
    id: 'alerts',
    category: { en: 'Operations', es: 'Operaciones' },
    title: { en: 'Alerts', es: 'Alertas' },
    description: {
      en: 'Track conversations and appointments that need attention.',
      es: 'Controla las conversaciones y citas que necesitan atencion.',
    },
    href: '/alerts',
    audience: 'all',
  },
  {
    id: 'waitlist',
    category: { en: 'Appointments', es: 'Citas' },
    title: { en: 'Waitlist', es: 'Lista de espera' },
    description: {
      en: 'Keep track of patients waiting for an available appointment.',
      es: 'Controla a los pacientes que esperan una cita disponible.',
    },
    href: '/waitlist',
    audience: 'all',
  },
  {
    id: 'workflows',
    category: { en: 'Automation', es: 'Automatizacion' },
    title: { en: 'Workflow automation', es: 'Automatizacion de flujos' },
    description: {
      en: 'Build and publish patient conversation workflows with configurable routing.',
      es: 'Crea y publica flujos de conversacion con rutas configurables.',
    },
    href: '/studio/workflows',
    audience: 'admin',
  },
  {
    id: 'ai-settings',
    category: { en: 'AI', es: 'IA' },
    title: { en: 'AI agents and providers', es: 'Agentes y proveedores de IA' },
    description: {
      en: 'Configure the AI service, model, and patient-answering controls.',
      es: 'Configura el servicio de IA, el modelo y los controles de respuesta.',
    },
    href: '/studio/ai-settings',
    audience: 'admin',
  },
  {
    id: 'knowledge-base',
    category: { en: 'Knowledge', es: 'Conocimiento' },
    title: { en: 'Clinic knowledge base', es: 'Base de conocimiento de la clinica' },
    description: {
      en: 'Approve and manage the clinic information used to ground AI answers.',
      es: 'Aprueba y gestiona la informacion que fundamenta las respuestas de IA.',
    },
    href: '/studio/kb',
    audience: 'admin',
  },
  {
    id: 'channels',
    category: { en: 'Integrations', es: 'Integraciones' },
    title: { en: 'Channels and integrations', es: 'Canales e integraciones' },
    description: {
      en: 'Connect and manage the messaging services used by the clinic.',
      es: 'Conecta y gestiona los servicios de mensajeria de la clinica.',
    },
    href: '/studio/channels',
    audience: 'admin',
  },
  {
    id: 'quick-replies',
    category: { en: 'Messaging', es: 'Mensajeria' },
    title: { en: 'Quick replies', es: 'Respuestas rapidas' },
    description: {
      en: 'Create reusable, clinic-approved responses for staff.',
      es: 'Crea respuestas reutilizables y aprobadas por la clinica.',
    },
    href: '/studio/quick-replies',
    audience: 'admin',
  },
  {
    id: 'clinics',
    category: { en: 'Administration', es: 'Administracion' },
    title: { en: 'Clinic management', es: 'Gestion de clinicas' },
    description: {
      en: 'Manage clinic profiles, plans, status, and readiness.',
      es: 'Gestiona perfiles, planes, estado y preparacion de las clinicas.',
    },
    href: '/studio/clinics',
    audience: 'platform',
  },
]

function permittedAudiences(role: string | null | undefined): Set<ProductAudience> {
  const audiences = new Set<ProductAudience>(['all'])
  if (role === 'clinic_admin' || role === 'ia_studio_admin') audiences.add('admin')
  if (role === 'ia_studio_admin') audiences.add('platform')
  return audiences
}

export function updatesForRole(
  role: string | null | undefined,
  updates: readonly ProductUpdate[] = PRODUCT_UPDATES,
): ProductUpdate[] {
  const allowed = permittedAudiences(role)
  return updates
    .filter((update) => allowed.has(update.audience))
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
}

export function featuresForRole(
  role: string | null | undefined,
  features: readonly ProductFeature[] = PRODUCT_FEATURES,
): ProductFeature[] {
  const allowed = permittedAudiences(role)
  return features.filter((feature) => allowed.has(feature.audience))
}

export function unseenProductUpdates(
  updates: readonly ProductUpdate[],
  lastSeenProductUpdateId: string | null | undefined,
): ProductUpdate[] {
  if (!lastSeenProductUpdateId) return [...updates]
  const acknowledgedIndex = updates.findIndex((update) => update.id === lastSeenProductUpdateId)
  return acknowledgedIndex < 0 ? [...updates] : updates.slice(0, acknowledgedIndex)
}
