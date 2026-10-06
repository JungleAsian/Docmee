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
    id: '2026-10-06-superuser-change-log',
    publishedAt: '2026-10-06T03:00:00.000Z',
    version: '2026.10.06.2',
    audience: 'platform',
    title: {
      en: 'Change log for superusers',
      es: 'Registro de cambios para superusuarios',
    },
    summary: {
      en: 'Every change to workflows, settings and configuration is now recorded with who made it, when, and exactly what changed.',
      es: 'Cada cambio en flujos, ajustes y configuración ahora queda registrado con quién lo hizo, cuándo y qué cambió exactamente.',
    },
    highlights: [
      {
        en: 'Open Studio → Compliance → Change log to review changes across every clinic, filtered by clinic, area, outcome or text.',
        es: 'Abre Studio → Cumplimiento → Registro de cambios para revisar los cambios de todas las clínicas, filtrando por clínica, área, resultado o texto.',
      },
      {
        en: 'Workflow edits show each step added, removed or edited with before and after values; clinic settings show every field that changed.',
        es: 'Las ediciones de flujos muestran cada paso agregado, eliminado o editado con valores antes y después; los ajustes de clínica muestran cada campo modificado.',
      },
      {
        en: 'Failed attempts are recorded too, passwords and keys are never stored, and only superusers can see the log.',
        es: 'También se registran los intentos fallidos, nunca se guardan contraseñas ni claves, y solo los superusuarios pueden ver el registro.',
      },
    ],
  },
  {
    id: '2026-10-06-reliable-booking-workflows',
    publishedAt: '2026-10-06T02:00:00.000Z',
    version: '2026.10.06',
    audience: 'all',
    title: {
      en: 'More reliable bookings and workflows',
      es: 'Citas y flujos más confiables',
    },
    summary: {
      en: 'Bookings no longer stall on a slow Google Calendar, WhatsApp, or AI provider, and patients are no longer silently blocked from your workflows.',
      es: 'Las citas ya no se detienen por demoras de Google Calendar, WhatsApp o del proveedor de IA, y los pacientes ya no quedan bloqueados en silencio fuera de sus flujos.',
    },
    highlights: [
      {
        en: 'Every Google Calendar, WhatsApp, and AI request now has a time limit, so a booking conversation can no longer freeze while waiting on another service.',
        es: 'Cada solicitud a Google Calendar, WhatsApp y a la IA ahora tiene un límite de tiempo, así que una conversación de cita ya no puede congelarse esperando a otro servicio.',
      },
      {
        en: 'Patients who reply "Cancel" or "End" to manage an appointment are no longer unsubscribed by mistake, and WhatsApp messages without a profile name are no longer dropped.',
        es: 'Los pacientes que responden "Cancel" o "End" para gestionar una cita ya no se dan de baja por error, y los mensajes de WhatsApp sin nombre de perfil ya no se pierden.',
      },
      {
        en: 'Clinic admins can let workflows and the assistant also answer during business hours (Studio → Clinic → Bot), and can delete a chat from the chat window with password confirmation.',
        es: 'Los administradores de clínica pueden permitir que los flujos y el asistente respondan también en horario de atención (Studio → Clínica → Bot) y pueden eliminar un chat desde la ventana del chat con confirmación de contraseña.',
      },
      {
        en: 'The Docmee logo now sits at the start of the top bar on every page, and "View all updates" opens this page without the popup reappearing.',
        es: 'El logo de Docmee ahora aparece al inicio de la barra superior en todas las páginas, y "Ver todas las novedades" abre esta página sin que la ventana vuelva a aparecer.',
      },
    ],
  },
  {
    id: '2026-10-02-cleaner-workflow-builder',
    publishedAt: '2026-10-02T17:30:00.000Z',
    version: '2026.10.02.2',
    audience: 'admin',
    title: {
      en: 'A cleaner workflow builder for every automation',
      es: 'Un constructor de flujos más claro para cada automatización',
    },
    summary: {
      en: 'Current and future workflows now share clearer navigation, explicit route focus, compact tools, and safer visual grouping without changing execution behavior.',
      es: 'Los flujos actuales y futuros ahora comparten navegación más clara, enfoque explícito de rutas, herramientas compactas y agrupación visual segura sin cambiar su ejecución.',
    },
    highlights: [
      {
        en: 'Search and status filters keep active workflows easy to find while archived workflows remain available on demand.',
        es: 'La búsqueda y los filtros de estado facilitan encontrar flujos activos, mientras los archivados siguen disponibles cuando se necesitan.',
      },
      {
        en: 'Collapsed groups combine equivalent visual connections while preserving every executable edge and branch.',
        es: 'Los grupos contraídos combinan conexiones visuales equivalentes y conservan cada conexión y rama ejecutable.',
      },
      {
        en: 'Route focus is now intentional, the simulator stays hidden until requested, and secondary actions are organized into compact menus.',
        es: 'El enfoque de ruta ahora es intencional, el simulador permanece oculto hasta solicitarlo y las acciones secundarias se organizan en menús compactos.',
      },
    ],
  },
  {
    id: '2026-10-02-workflow-diagnostics',
    publishedAt: '2026-10-02T12:00:00.000Z',
    version: '2026.10.02',
    audience: 'platform',
    title: {
      en: 'Safe workflow diagnostics for superusers',
      es: 'Diagnóstico seguro de flujos para superusuarios',
    },
    summary: {
      en: 'Superusers can now check a saved workflow, preview unsaved edits, and review recent execution evidence without contacting patients or external services.',
      es: 'Los superusuarios ahora pueden revisar un flujo guardado, probar cambios sin guardar y consultar evidencia de ejecuciones recientes sin contactar a pacientes ni servicios externos.',
    },
    highlights: [
      {
        en: 'Workflow checks identify blocking errors and warnings, with a direct path back to the affected node or connection.',
        es: 'Las comprobaciones del flujo identifican errores bloqueantes y advertencias, con acceso directo al nodo o conexión afectados.',
      },
      {
        en: 'A side-effect-free safe test shows whether the current workflow can complete without sending messages, creating appointments, or calling external integrations.',
        es: 'Una prueba segura y sin efectos secundarios muestra si el flujo puede completarse sin enviar mensajes, crear citas ni llamar integraciones externas.',
      },
      {
        en: 'Integration readiness and privacy-redacted recent runs provide operational evidence while keeping the tool restricted to superusers.',
        es: 'La preparación de integraciones y las ejecuciones recientes con datos sensibles ocultos aportan evidencia operativa, manteniendo la herramienta restringida a superusuarios.',
      },
    ],
  },
  {
    id: '2026-09-25-governed-kb-retrieval',
    publishedAt: '2026-09-25T16:30:00.000Z',
    version: '2026.09.25.2',
    audience: 'admin',
    title: { en: 'More accurate, governed clinic knowledge', es: 'Conocimiento clínico más preciso y controlado' },
    summary: {
      en: 'J.zel, workflow AI agents, and answer previews now share one clinic-scoped retrieval and safety contract.',
      es: 'J.zel, los agentes de IA de los flujos y las vistas previas ahora comparten un único contrato de recuperación y seguridad por clínica.',
    },
    highlights: [
      { en: 'Hybrid semantic and keyword retrieval prioritizes the current language, doctor, authority, and approved source revision.', es: 'La recuperación semántica y por palabras clave prioriza el idioma, el médico, la autoridad y la revisión aprobada actual.' },
      { en: 'Conflicting, superseded, stale, weak, or ungrounded evidence is withheld and handed to clinic staff instead of being guessed.', es: 'La evidencia conflictiva, reemplazada, desactualizada, débil o sin fundamento se retiene y se deriva al personal de la clínica en lugar de adivinar.' },
      { en: 'Markdown knowledge is chunked with section provenance, unchanged chunks reuse embeddings, and privacy-safe retrieval metrics support quality reviews.', es: 'El conocimiento Markdown se divide con procedencia por sección, los fragmentos sin cambios reutilizan embeddings y las métricas privadas apoyan las revisiones de calidad.' },
    ],
  },
  {
    id: '2026-09-25-jzel-teaching',
    publishedAt: '2026-09-25T00:00:00.000Z',
    version: '2026.09.25',
    audience: 'admin',
    title: { en: 'Train J.zel from the assistant', es: 'Entrena a J.zel desde el asistente' },
    summary: {
      en: 'Prepare and approve clinic knowledge in Train J.zel, then preview a workflow answer without sending a message.',
      es: 'Prepara y aprueba información de la clínica en Entrenar a J.zel y prueba una respuesta del flujo sin enviar mensajes.',
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
