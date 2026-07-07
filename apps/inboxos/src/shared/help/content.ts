// Docmee Help Center - self-contained bilingual (ES/EN) user knowledge base.
// Keep this user-facing: no developer setup, secrets, infrastructure, or internal notes.
import type { PanelLanguage } from '../types'

export type Localized = Record<PanelLanguage, string>

export function L(value: Localized, lang: PanelLanguage): string {
  return value[lang] ?? value.en ?? value.es
}

export type HelpBlock =
  | { type: 'h'; text: Localized }
  | { type: 'p'; text: Localized }
  | { type: 'ul'; items: Localized[] }
  | { type: 'steps'; items: Localized[] }
  | { type: 'note'; text: Localized }
  | { type: 'video'; title: Localized; src: Localized; caption?: Localized }

export interface HelpArticle {
  slug: string
  title: Localized
  excerpt: Localized
  body: HelpBlock[]
}

export interface HelpArticleTarget {
  href: string
  label: Localized
}

export interface HelpCategory {
  slug: string
  icon: string
  title: Localized
  description: Localized
  articles: HelpArticle[]
}

export const HELP_UI = {
  navHelp: { es: 'Ayuda', en: 'Help' },
  title: { es: 'Centro de ayuda', en: 'Help Center' },
  subtitle: {
    es: 'Guias claras para usar Docmee con confianza y contactar soporte solo cuando sea necesario.',
    en: 'Clear guides to use Docmee confidently and contact support only when needed.',
  },
  searchPlaceholder: { es: 'Buscar por tema, pantalla o tarea...', en: 'Search by topic, screen, or task...' },
  popular: { es: 'Articulos populares', en: 'Popular articles' },
  browse: { es: 'Explorar por categoria', en: 'Browse by category' },
  articlesCount: { es: 'articulos', en: 'articles' },
  articleSingular: { es: 'articulo', en: 'article' },
  backToHelp: { es: 'Centro de ayuda', en: 'Help Center' },
  inThisCategory: { es: 'Articulos en esta categoria', en: 'Articles in this category' },
  related: { es: 'Articulos relacionados', en: 'Related articles' },
  searchResults: { es: 'Resultados de busqueda', en: 'Search results' },
  resultsFor: { es: 'Resultados para', en: 'Results for' },
  noResults: {
    es: 'No encontramos articulos. Prueba con palabras como WhatsApp, cita, usuario, alerta o J.zel.',
    en: 'No articles found. Try words like WhatsApp, appointment, user, alert, or J.zel.',
  },
  clearSearch: { es: 'Limpiar', en: 'Clear' },
  wasHelpfulTitle: { es: 'Te resulto util este articulo?', en: 'Was this article helpful?' },
  contactTitle: { es: 'Aun necesitas ayuda?', en: 'Still need help?' },
  contactBody: {
    es: 'Primero revisa esta guia y los articulos relacionados. Si el problema continua, contacta soporte con la clinica, usuario, pantalla y una captura.',
    en: 'First review this guide and related articles. If the issue continues, contact support with the clinic, user, screen, and a screenshot.',
  },
  contactCta: { es: 'Contactar a soporte', en: 'Contact support' },
  yes: { es: 'Si', en: 'Yes' },
  no: { es: 'No', en: 'No' },
  thanks: { es: 'Gracias por tu comentario.', en: 'Thanks for your feedback.' },
} satisfies Record<string, Localized>

const SUPPORT_CHECKLIST = {
  es: 'Antes de contactar soporte: recarga la pagina, revisa tu conexion, confirma que estas en la clinica correcta, cierra e inicia sesion, y toma una captura del error.',
  en: 'Before contacting support: refresh the page, check your connection, confirm you are in the correct clinic, sign out and in, and take a screenshot of the error.',
}

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    slug: 'getting-started',
    icon: 'kb',
    title: { es: 'Primeros pasos', en: 'Getting Started' },
    description: {
      es: 'Aprende a entrar, navegar, cambiar idioma, instalar la app y trabajar con seguridad.',
      en: 'Learn how to sign in, navigate, switch language, install the app, and work safely.',
    },
    articles: [
      {
        slug: 'welcome-to-docmee',
        title: { es: 'Bienvenido a Docmee', en: 'Welcome to Docmee' },
        excerpt: {
          es: 'Que es Docmee y como ayuda a tu clinica a responder, agendar y dar seguimiento.',
          en: 'What Docmee is and how it helps your clinic reply, book, and follow up.',
        },
        body: [
          {
            type: 'p',
            text: {
              es: 'Docmee centraliza mensajes, citas, pacientes, automatizaciones, reportes y ayuda en un solo lugar. Su objetivo es que el equipo atienda mas rapido, reduzca tareas repetitivas y de seguimiento claro al paciente.',
              en: 'Docmee centralizes messages, appointments, patients, automations, reports, and help in one place. Its goal is to help the team respond faster, reduce repetitive tasks, and follow up clearly with patients.',
            },
          },
          {
            type: 'video',
            title: { es: 'Guia rapida de Docmee', en: 'Docmee quick guide' },
            src: { es: '/help/docmee-quick-guide.html', en: '/help/docmee-quick-guide.html' },
            caption: {
              es: 'Un recorrido visual por bandeja, agenda, ayuda, reportes y Admin Studio.',
              en: 'A visual walkthrough of Inbox, Calendar, Help, Reports, and Admin Studio.',
            },
          },
          { type: 'h', text: { es: 'Secciones principales', en: 'Main sections' } },
          {
            type: 'ul',
            items: [
              { es: 'Bandeja: responde mensajes y revisa el historial del paciente.', en: 'Inbox: reply to messages and review patient history.' },
              { es: 'Calendario: crea, mueve, cancela y revisa citas.', en: 'Calendar: create, move, cancel, and review appointments.' },
              { es: 'Alertas: revisa avisos de WhatsApp, reservas, cancelaciones y cambios.', en: 'Alerts: review notices for WhatsApp, bookings, cancellations, and changes.' },
              { es: 'Reportes y metricas: entiende volumen, tiempos de respuesta y desempeno.', en: 'Reports and metrics: understand volume, response times, and performance.' },
              { es: 'Admin Studio: configura usuarios, canales, doctores, plantillas, automatizaciones y J.zel.', en: 'Admin Studio: configure users, channels, doctors, templates, automations, and J.zel.' },
            ],
          },
          { type: 'note', text: { es: 'Tu menu depende de tu rol y de los permisos activados por el administrador.', en: 'Your menu depends on your role and the permissions enabled by your administrator.' } },
        ],
      },
      {
        slug: 'sign-in-session-language',
        title: { es: 'Iniciar sesion, idioma y cierre automatico', en: 'Sign in, language, and automatic logout' },
        excerpt: {
          es: 'Como entrar, cambiar idioma y entender el cierre por inactividad.',
          en: 'How to sign in, switch language, and understand inactivity logout.',
        },
        body: [
          {
            type: 'steps',
            items: [
              { es: 'Abre Docmee en el navegador o desde la app instalada.', en: 'Open Docmee in the browser or from the installed app.' },
              { es: 'Escribe tu usuario o correo y contrasena aprobados.', en: 'Enter your approved username or email and password.' },
              { es: 'Selecciona Iniciar sesion. Si tus datos son correctos, veras las pantallas permitidas para tu rol.', en: 'Select Sign in. If your details are correct, you will see the screens allowed for your role.' },
            ],
          },
          {
            type: 'p',
            text: {
              es: 'Docmee puede usarse en Espanol o Ingles. Tambien puede cerrar tu sesion despues de un periodo sin actividad. Esto protege la informacion de pacientes en computadoras compartidas o desatendidas.',
              en: 'Docmee can be used in Spanish or English. It can also sign you out after a period without activity. This protects patient information on shared or unattended computers.',
            },
          },
          { type: 'note', text: SUPPORT_CHECKLIST },
        ],
      },
      {
        slug: 'install-app-notifications',
        title: { es: 'Instalar Docmee y activar notificaciones', en: 'Install Docmee and enable notifications' },
        excerpt: {
          es: 'Instala Docmee como app para acceso rapido y alertas.',
          en: 'Install Docmee as an app for quick access and alerts.',
        },
        body: [
          {
            type: 'steps',
            items: [
              { es: 'Abre Docmee en Chrome, Edge, Safari u otro navegador compatible.', en: 'Open Docmee in Chrome, Edge, Safari, or another compatible browser.' },
              { es: 'Busca Instalar, Agregar a pantalla de inicio o el icono de instalacion.', en: 'Look for Install, Add to Home Screen, or the install icon.' },
              { es: 'Confirma la instalacion y abre Docmee desde el nuevo icono.', en: 'Confirm the installation and open Docmee from the new icon.' },
              { es: 'Permite notificaciones si quieres recibir alertas de mensajes y eventos.', en: 'Allow notifications if you want alerts for messages and events.' },
            ],
          },
          { type: 'note', text: { es: 'Si no llegan notificaciones, revisa permisos del navegador, modo no molestar y preferencias de alertas del usuario.', en: 'If notifications do not arrive, check browser permissions, do-not-disturb mode, and the user alert preferences.' } },
        ],
      },
    ],
  },
  {
    slug: 'inbox',
    icon: 'inbox',
    title: { es: 'Bandeja y conversaciones', en: 'Inbox & Conversations' },
    description: {
      es: 'Responde, asigna, filtra y organiza conversaciones con pacientes.',
      en: 'Reply, assign, filter, and organize patient conversations.',
    },
    articles: [
      {
        slug: 'manage-conversations',
        title: { es: 'Gestionar conversaciones', en: 'Manage conversations' },
        excerpt: {
          es: 'Lee, busca, responde y mantiene ordenada la bandeja.',
          en: 'Read, search, reply, and keep the inbox organized.',
        },
        body: [
          {
            type: 'p',
            text: {
              es: 'La bandeja muestra conversaciones de los canales conectados, con estado, asignacion, ultimo mensaje y datos del paciente cuando existen. Es la pantalla principal para atender mensajes.',
              en: 'The inbox shows conversations from connected channels, with status, assignment, latest message, and patient details when available. It is the main screen for handling messages.',
            },
          },
          {
            type: 'steps',
            items: [
              { es: 'Usa filtros o busqueda para encontrar una conversacion por paciente, telefono, estado o contenido.', en: 'Use filters or search to find a conversation by patient, phone, status, or content.' },
              { es: 'Abre la conversacion y lee el historial antes de responder.', en: 'Open the conversation and read the history before replying.' },
              { es: 'Escribe una respuesta clara; revisa cualquier sugerencia de J.zel antes de enviarla.', en: 'Write a clear reply; review any J.zel suggestion before sending it.' },
              { es: 'Actualiza el estado cuando la solicitud quede atendida.', en: 'Update the status when the request has been handled.' },
            ],
          },
          { type: 'note', text: { es: 'Si la pantalla se ve comprimida, oculta el menu lateral o aumenta el ancho de la ventana.', en: 'If the screen looks compressed, hide the side rail or widen the window.' } },
        ],
      },
      {
        slug: 'assignments-statuses-handoff',
        title: { es: 'Asignaciones, traspasos y estados', en: 'Assignments, handoff, and statuses' },
        excerpt: {
          es: 'Usa responsables y estados para evitar duplicados y perder pendientes.',
          en: 'Use owners and statuses to avoid duplicates and missed follow-ups.',
        },
        body: [
          {
            type: 'ul',
            items: [
              { es: 'Abierta: conversacion nueva o pendiente de respuesta.', en: 'Open: new conversation or waiting for a reply.' },
              { es: 'Pendiente: falta informacion, confirmacion o accion posterior.', en: 'Pending: waiting for information, confirmation, or later action.' },
              { es: 'Asignada: una persona del equipo es responsable.', en: 'Assigned: one team member is responsible.' },
              { es: 'Traspaso: necesita atencion humana, otro usuario o un bot disponible.', en: 'Handoff: needs human attention, another user, or an available bot.' },
              { es: 'Resuelta: la solicitud fue atendida y no requiere accion inmediata.', en: 'Resolved: the request was handled and no immediate action is needed.' },
            ],
          },
          { type: 'note', text: { es: 'Usuarios no administradores solo pueden asignar o traspasar a cuentas no administradoras o a un bot de IA disponible.', en: 'Non-admin users can only assign or hand off to non-admin accounts or an available AI bot.' } },
        ],
      },
      {
        slug: 'voice-notes-media',
        title: { es: 'Notas de voz, imagenes y archivos', en: 'Voice notes, images, and files' },
        excerpt: {
          es: 'Que ocurre cuando un paciente envia audio u otro contenido.',
          en: 'What happens when a patient sends audio or other content.',
        },
        body: [
          {
            type: 'p',
            text: {
              es: 'Docmee puede recibir notas de voz de WhatsApp. Cuando la transcripcion esta configurada, el audio se convierte en texto, se guarda en la conversacion y J.zel puede usarlo como contexto.',
              en: 'Docmee can receive WhatsApp voice notes. When transcription is configured, audio is converted to text, saved in the conversation, and J.zel can use it as context.',
            },
          },
          {
            type: 'ul',
            items: [
              { es: 'La bandeja muestra la nota de voz con marcador de audio y transcripcion cuando existe.', en: 'The inbox shows the voice note with an audio marker and transcript when available.' },
              { es: 'Si el audio no tiene voz clara, la transcripcion puede quedar vacia o incompleta.', en: 'If the audio does not have clear speech, the transcript may be empty or incomplete.' },
              { es: 'Revisa la transcripcion antes de confirmar citas o tomar decisiones importantes.', en: 'Review the transcript before confirming appointments or making important decisions.' },
            ],
          },
        ],
      },
      {
        slug: 'internal-notes',
        title: { es: 'Notas internas', en: 'Internal notes' },
        excerpt: {
          es: 'Deja contexto para el equipo sin enviarlo al paciente.',
          en: 'Leave context for the team without sending it to the patient.',
        },
        body: [
          {
            type: 'p',
            text: {
              es: 'Las notas internas son visibles para tu equipo, pero no se envian al paciente. Usalas para dejar contexto de turno, instrucciones, pendientes o razon de una decision.',
              en: 'Internal notes are visible to your team but are not sent to the patient. Use them for shift context, instructions, pending tasks, or the reason for a decision.',
            },
          },
          { type: 'note', text: { es: 'Mantener notas claras y breves ayuda al siguiente usuario.', en: 'Clear, brief notes help the next user.' } },
        ],
      },
    ],
  },
  {
    slug: 'appointments',
    icon: 'calendar',
    title: { es: 'Citas y calendario', en: 'Appointments & Calendar' },
    description: {
      es: 'Agenda, cambia, cancela y da seguimiento a citas.',
      en: 'Book, change, cancel, and follow up on appointments.',
    },
    articles: [
      {
        slug: 'book-appointment',
        title: { es: 'Agendar una cita', en: 'Book an appointment' },
        excerpt: {
          es: 'Crea citas desde calendario o conversacion.',
          en: 'Create appointments from calendar or conversation.',
        },
        body: [
          {
            type: 'steps',
            items: [
              { es: 'Abre Calendario o la conversacion del paciente.', en: 'Open Calendar or the patient conversation.' },
              { es: 'Elige doctor, servicio o motivo cuando aplique.', en: 'Choose doctor, service, or reason when applicable.' },
              { es: 'Selecciona fecha y hora disponible.', en: 'Select an available date and time.' },
              { es: 'Confirma datos del paciente y agrega notas utiles.', en: 'Confirm patient details and add useful notes.' },
              { es: 'Guarda la cita y verifica que aparezca en el calendario.', en: 'Save the appointment and verify it appears on the calendar.' },
            ],
          },
          { type: 'note', text: { es: 'Si el paciente viene de una conversacion, confirma que el contacto sea correcto.', en: 'If the patient comes from a conversation, confirm the contact is correct.' } },
        ],
      },
      {
        slug: 'reschedule-cancel-no-show',
        title: { es: 'Reprogramar, cancelar y marcar inasistencia', en: 'Reschedule, cancel, and mark no-show' },
        excerpt: {
          es: 'Mantiene el historial correcto cuando una cita cambia.',
          en: 'Keep history correct when an appointment changes.',
        },
        body: [
          {
            type: 'p',
            text: {
              es: 'Cuando una cita cambia, abre la cita existente y usa reprogramar o cancelar en lugar de crear una cita nueva. Asi el historial y reportes quedan correctos.',
              en: 'When an appointment changes, open the existing appointment and use reschedule or cancel instead of creating a new appointment. This keeps history and reports correct.',
            },
          },
          {
            type: 'ul',
            items: [
              { es: 'Reprogramar cambia fecha u hora y conserva el historial.', en: 'Reschedule changes date or time and preserves history.' },
              { es: 'Cancelar registra que la cita no ocurrira.', en: 'Cancel records that the appointment will not happen.' },
              { es: 'No asistio ayuda a medir ausencias y activar seguimiento.', en: 'No-show helps measure missed visits and trigger follow-up.' },
            ],
          },
        ],
      },
      {
        slug: 'doctors-services-availability',
        title: { es: 'Doctores, servicios y disponibilidad', en: 'Doctors, services, and availability' },
        excerpt: {
          es: 'Configura quien atiende, que servicios ofrece y que horarios se reservan.',
          en: 'Configure who provides care, what services are offered, and which times are bookable.',
        },
        body: [
          {
            type: 'p',
            text: {
              es: 'La disponibilidad determina que horarios pueden reservarse. Mantener doctores, servicios, duraciones y horarios al dia evita citas incorrectas o solapadas.',
              en: 'Availability determines which times can be booked. Keeping doctors, services, durations, and schedules current prevents incorrect or overlapping appointments.',
            },
          },
          { type: 'note', text: { es: 'Si un doctor no aparece, revisa que este activo y en la clinica correcta.', en: 'If a doctor does not appear, confirm they are active and in the correct clinic.' } },
        ],
      },
    ],
  },
  {
    slug: 'channels',
    icon: 'channels',
    title: { es: 'Canales y WhatsApp', en: 'Channels & WhatsApp' },
    description: {
      es: 'Conecta y usa WhatsApp, Messenger, Instagram y plantillas.',
      en: 'Connect and use WhatsApp, Messenger, Instagram, and templates.',
    },
    articles: [
      {
        slug: 'whatsapp-overview',
        title: { es: 'Como funciona WhatsApp en Docmee', en: 'How WhatsApp works in Docmee' },
        excerpt: {
          es: 'Mensajes entrantes, respuestas, ventana de 24 horas y numero activo.',
          en: 'Inbound messages, replies, the 24-hour window, and the active number.',
        },
        body: [
          {
            type: 'p',
            text: {
              es: 'Cuando WhatsApp esta conectado, los mensajes de pacientes llegan a la bandeja. El equipo puede responder, J.zel puede ayudar y las citas pueden confirmarse desde la conversacion.',
              en: 'When WhatsApp is connected, patient messages arrive in the inbox. The team can reply, J.zel can help, and appointments can be confirmed from the conversation.',
            },
          },
          {
            type: 'ul',
            items: [
              { es: 'Dentro de la ventana de 24 horas puedes responder normalmente.', en: 'Inside the 24-hour window you can reply normally.' },
              { es: 'Fuera de la ventana, WhatsApp puede requerir una plantilla aprobada.', en: 'Outside the window, WhatsApp may require an approved template.' },
              { es: 'El numero activo se revisa en Admin Studio > Canales.', en: 'The active number is reviewed in Admin Studio > Channels.' },
            ],
          },
        ],
      },
      {
        slug: 'connect-update-whatsapp',
        title: { es: 'Conectar o actualizar WhatsApp', en: 'Connect or update WhatsApp' },
        excerpt: {
          es: 'Pasos de alto nivel para administrar el canal de WhatsApp.',
          en: 'High-level steps to manage the WhatsApp channel.',
        },
        body: [
          {
            type: 'steps',
            items: [
              { es: 'Entra con usuario administrador y abre Admin Studio > Canales.', en: 'Sign in as an administrator and open Admin Studio > Channels.' },
              { es: 'Selecciona WhatsApp y revisa numero, nombre visible y estado.', en: 'Select WhatsApp and review number, display name, and status.' },
              { es: 'Ingresa o actualiza los datos solicitados en pantalla.', en: 'Enter or update the details requested on screen.' },
              { es: 'Guarda cambios y usa prueba de envio si esta disponible.', en: 'Save changes and use the send test if available.' },
              { es: 'Confirma que la respuesta del paciente entra a la bandeja.', en: 'Confirm the patient reply appears in the inbox.' },
            ],
          },
          { type: 'note', text: { es: 'Si no ves Canales, pide al administrador revisar tus permisos.', en: 'If you do not see Channels, ask the administrator to review your permissions.' } },
        ],
      },
      {
        slug: 'channel-troubleshooting',
        title: { es: 'Problemas de canal', en: 'Channel troubleshooting' },
        excerpt: {
          es: 'Que revisar si no llegan mensajes o no se pueden enviar respuestas.',
          en: 'What to check if messages do not arrive or replies cannot be sent.',
        },
        body: [
          {
            type: 'steps',
            items: [
              { es: 'Revisa si el canal aparece activo en Admin Studio > Canales.', en: 'Check whether the channel appears active in Admin Studio > Channels.' },
              { es: 'Confirma que estas en la clinica correcta.', en: 'Confirm you are in the correct clinic.' },
              { es: 'Envia un mensaje de prueba cuando la pantalla lo permita.', en: 'Send a test message when the screen allows it.' },
              { es: 'Pide al paciente responder para validar entrada y salida.', en: 'Ask the patient to reply to validate inbound and outbound flow.' },
              { es: 'Si falla, guarda el error visible y toma captura.', en: 'If it fails, save the visible error and take a screenshot.' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'jzel-ai',
    icon: 'automations',
    title: { es: 'J.zel y automatizaciones', en: 'J.zel & Automations' },
    description: {
      es: 'Usa el asistente de IA, base de conocimiento, flujos y recordatorios.',
      en: 'Use the AI assistant, knowledge base, flows, and reminders.',
    },
    articles: [
      {
        slug: 'meet-jzel',
        title: { es: 'Conoce a J.zel', en: 'Meet J.zel' },
        excerpt: {
          es: 'Que hace J.zel y como ayuda a pacientes y equipo.',
          en: 'What J.zel does and how it helps patients and staff.',
        },
        body: [
          {
            type: 'p',
            text: {
              es: 'J.zel es el asistente de IA de Docmee. Puede responder preguntas frecuentes, clasificar mensajes, preparar respuestas, apoyar reservas y orientar al usuario dentro de la aplicacion.',
              en: 'J.zel is Docmee AI assistant. It can answer frequent questions, triage messages, draft replies, support bookings, and guide users inside the application.',
            },
          },
          {
            type: 'ul',
            items: [
              { es: 'Usa informacion autorizada de la clinica y contexto de conversacion.', en: 'It uses authorized clinic information and conversation context.' },
              { es: 'El equipo debe revisar respuestas importantes antes de enviarlas.', en: 'The team should review important replies before sending.' },
              { es: 'Si no sabe una respuesta, debe pedir aclaracion o escalar.', en: 'If it does not know an answer, it should ask for clarification or escalate.' },
            ],
          },
          { type: 'note', text: { es: 'J.zel ayuda al equipo; no reemplaza criterio medico o administrativo.', en: 'J.zel assists the team; it does not replace medical or administrative judgment.' } },
        ],
      },
      {
        slug: 'knowledge-base',
        title: { es: 'Base de conocimiento', en: 'Knowledge base' },
        excerpt: {
          es: 'Mantiene informacion clara para que J.zel y el equipo respondan mejor.',
          en: 'Keep information clear so J.zel and the team can answer better.',
        },
        body: [
          {
            type: 'p',
            text: {
              es: 'La base de conocimiento debe incluir horarios, servicios, politicas, preparaciones, ubicacion, reglas de cancelacion y preguntas frecuentes.',
              en: 'The knowledge base should include hours, services, policies, preparation instructions, location, cancellation rules, and FAQs.',
            },
          },
          {
            type: 'ul',
            items: [
              { es: 'Mantiene articulos cortos, claros y actualizados.', en: 'Keep articles short, clear, and current.' },
              { es: 'Actualiza contenido cuando cambien doctores, horarios, servicios o politicas.', en: 'Update content when doctors, hours, services, or policies change.' },
              { es: 'Evita informacion duplicada o contradictoria.', en: 'Avoid duplicate or conflicting information.' },
            ],
          },
        ],
      },
      {
        slug: 'automations-workflows',
        title: { es: 'Automatizaciones, flujos y recordatorios', en: 'Automations, flows, and reminders' },
        excerpt: {
          es: 'Automatiza tareas repetitivas sin perder control humano.',
          en: 'Automate repetitive tasks without losing human control.',
        },
        body: [
          {
            type: 'steps',
            items: [
              { es: 'Define el objetivo: recordatorio, confirmacion, seguimiento o triage.', en: 'Define the goal: reminder, confirmation, follow-up, or triage.' },
              { es: 'Selecciona el disparador correcto, como cita creada o mensaje recibido.', en: 'Choose the correct trigger, such as appointment created or message received.' },
              { es: 'Escribe mensajes claros para pacientes.', en: 'Write clear messages for patients.' },
              { es: 'Prueba el flujo con un caso pequeno antes de usarlo ampliamente.', en: 'Test the flow with a small case before using it broadly.' },
            ],
          },
          { type: 'note', text: { es: 'Si una automatizacion confunde a pacientes, pausala y ajusta texto o condiciones.', en: 'If an automation confuses patients, pause it and adjust text or conditions.' } },
        ],
      },
    ],
  },
  {
    slug: 'templates',
    icon: 'templates',
    title: { es: 'Plantillas y respuestas rapidas', en: 'Templates & Quick Replies' },
    description: {
      es: 'Ahorra tiempo con mensajes guardados y plantillas aprobadas.',
      en: 'Save time with saved messages and approved templates.',
    },
    articles: [
      {
        slug: 'quick-replies',
        title: { es: 'Usar respuestas rapidas', en: 'Use quick replies' },
        excerpt: { es: 'Inserta mensajes frecuentes sin escribirlos cada vez.', en: 'Insert frequent messages without typing them every time.' },
        body: [
          {
            type: 'p',
            text: {
              es: 'Las respuestas rapidas sirven para horarios, ubicacion, preparaciones, pagos, confirmaciones y otros textos repetidos. Lee el contexto y edita el mensaje si el paciente necesita una respuesta personalizada.',
              en: 'Quick replies are useful for hours, location, preparation instructions, payments, confirmations, and other repeated text. Read the context and edit the message if the patient needs a personalized answer.',
            },
          },
        ],
      },
      {
        slug: 'whatsapp-templates',
        title: { es: 'Plantillas de WhatsApp', en: 'WhatsApp templates' },
        excerpt: { es: 'Cuando usar plantillas aprobadas por WhatsApp.', en: 'When to use WhatsApp-approved templates.' },
        body: [
          {
            type: 'p',
            text: {
              es: 'WhatsApp puede exigir plantillas aprobadas para iniciar una conversacion o escribir fuera de la ventana permitida. Usa lenguaje claro, evita informacion sensible innecesaria y revisa el estado de aprobacion antes de usarla.',
              en: 'WhatsApp may require approved templates to start a conversation or message outside the allowed window. Use clear language, avoid unnecessary sensitive information, and review approval status before using one.',
            },
          },
        ],
      },
    ],
  },
  {
    slug: 'admin-studio',
    icon: 'compliance',
    title: { es: 'Admin Studio y usuarios', en: 'Admin Studio & Users' },
    description: {
      es: 'Configura usuarios, permisos, alertas, clinicas y menu lateral.',
      en: 'Configure users, permissions, alerts, clinics, and side rail.',
    },
    articles: [
      {
        slug: 'roles-permissions-menu',
        title: { es: 'Roles, permisos y menu lateral', en: 'Roles, permissions, and side rail' },
        excerpt: { es: 'Entiende que puede hacer cada rol y por que algunos menus no aparecen.', en: 'Understand what each role can do and why some menus may not appear.' },
        body: [
          {
            type: 'ul',
            items: [
              { es: 'Secretaria: conversaciones, citas y tareas operativas permitidas.', en: 'Secretary: conversations, appointments, and allowed operational tasks.' },
              { es: 'Doctor: conversaciones, citas e informacion relacionada a su atencion.', en: 'Doctor: conversations, appointments, and information related to their care.' },
              { es: 'Administrador de clinica: usuarios, configuracion, canales y reportes permitidos.', en: 'Clinic admin: users, configuration, channels, and allowed reports.' },
              { es: 'Superusuario: varias clinicas y ajustes globales.', en: 'Superuser: multiple clinics and global settings.' },
            ],
          },
          { type: 'p', text: { es: 'El administrador puede activar permisos por rol y ocultar elementos del menu lateral para simplificar la experiencia del equipo.', en: 'The administrator can enable permissions by role and hide side-rail items to simplify the team experience.' } },
        ],
      },
      {
        slug: 'manage-users-alerts',
        title: { es: 'Administrar usuarios y alertas', en: 'Manage users and alerts' },
        excerpt: { es: 'Crea usuarios, define rol, idioma, cierre automatico y alertas.', en: 'Create users, define role, language, automatic logout, and alerts.' },
        body: [
          {
            type: 'steps',
            items: [
              { es: 'Abre Admin Studio > Usuarios.', en: 'Open Admin Studio > Users.' },
              { es: 'Selecciona la clinica correcta si tienes acceso a varias.', en: 'Select the correct clinic if you have access to several.' },
              { es: 'Agrega o edita nombre, correo, rol, idioma y tiempo de inactividad.', en: 'Add or edit name, email, role, language, and inactivity timeout.' },
              { es: 'Marca alertas: WhatsApp, alarma interna, nueva reserva, cancelacion y revision de cita.', en: 'Select alerts: WhatsApp, internal alarm, new booking, cancellation, and booking revision.' },
              { es: 'Guarda y pide al usuario cerrar e iniciar sesion si no ve el cambio.', en: 'Save and ask the user to sign out and back in if they do not see the change.' },
            ],
          },
          { type: 'note', text: { es: 'No compartas cuentas. Cada persona debe usar su propio usuario.', en: 'Do not share accounts. Each person should use their own user.' } },
        ],
      },
      {
        slug: 'clinic-switching',
        title: { es: 'Cambiar entre clinicas', en: 'Switch between clinics' },
        excerpt: { es: 'Como trabajar en la clinica correcta si tienes acceso a varias.', en: 'How to work in the correct clinic if you have access to several.' },
        body: [
          { type: 'p', text: { es: 'Antes de cambiar configuraciones, responder mensajes o revisar reportes, confirma que el selector muestra la clinica correcta. Los datos estan separados por clinica.', en: 'Before changing settings, replying to messages, or reviewing reports, confirm the selector shows the correct clinic. Data is separated by clinic.' } },
        ],
      },
    ],
  },
  {
    slug: 'analytics',
    icon: 'metrics',
    title: { es: 'Metricas, reportes y calidad', en: 'Metrics, Reports & Quality' },
    description: { es: 'Mide volumen, respuesta, citas y calidad de servicio.', en: 'Measure volume, response, appointments, and quality of service.' },
    articles: [
      {
        slug: 'dashboards',
        title: { es: 'Usar metricas y analitica', en: 'Use metrics and analytics' },
        excerpt: { es: 'Que revisar para entender el desempeno de la clinica.', en: 'What to review to understand clinic performance.' },
        body: [
          {
            type: 'ul',
            items: [
              { es: 'Volumen de conversaciones: demanda y horarios pico.', en: 'Conversation volume: demand and peak hours.' },
              { es: 'Tiempos de respuesta: rapidez del equipo.', en: 'Response times: team speed.' },
              { es: 'Citas y ausencias: oportunidades de confirmacion y recordatorio.', en: 'Appointments and no-shows: confirmation and reminder opportunities.' },
              { es: 'Resolucion por IA: cuanto apoya J.zel.', en: 'AI resolution: how much J.zel helps.' },
            ],
          },
        ],
      },
      {
        slug: 'reports-quality',
        title: { es: 'Reportes y calidad de servicio', en: 'Reports and quality of service' },
        excerpt: { es: 'Usa reportes y QoS para detectar retrasos y pendientes.', en: 'Use reports and QoS to detect delays and pending work.' },
        body: [
          { type: 'p', text: { es: 'Los reportes resumen actividad importante para reuniones y seguimiento. La pantalla de calidad ayuda a identificar conversaciones sin respuesta, tiempos altos y areas donde el equipo necesita apoyo.', en: 'Reports summarize important activity for meetings and follow-up. The quality screen helps identify unanswered conversations, high response times, and areas where the team needs support.' } },
          { type: 'note', text: { es: 'Usa rangos de fecha consistentes cuando compares semanas o meses.', en: 'Use consistent date ranges when comparing weeks or months.' } },
        ],
      },
    ],
  },
  {
    slug: 'security-troubleshooting',
    icon: 'compliance',
    title: { es: 'Seguridad y solucion de problemas', en: 'Security & Troubleshooting' },
    description: { es: 'Buenas practicas y pasos para resolver problemas comunes.', en: 'Best practices and steps to solve common issues.' },
    articles: [
      {
        slug: 'security-best-practices',
        title: { es: 'Buenas practicas de seguridad', en: 'Security best practices' },
        excerpt: { es: 'Protege cuentas, pacientes y conversaciones.', en: 'Protect accounts, patients, and conversations.' },
        body: [
          {
            type: 'ul',
            items: [
              { es: 'Usa tu propia cuenta; no compartas usuarios ni contrasenas.', en: 'Use your own account; do not share users or passwords.' },
              { es: 'Cierra sesion en equipos compartidos.', en: 'Sign out on shared computers.' },
              { es: 'No pegues informacion sensible donde no sea necesaria.', en: 'Do not paste sensitive information where it is not needed.' },
              { es: 'Verifica paciente, telefono y cita antes de confirmar cambios.', en: 'Verify patient, phone, and appointment before confirming changes.' },
              { es: 'Reporta accesos incorrectos o pantallas que no deberias ver.', en: 'Report incorrect access or screens you should not be able to see.' },
            ],
          },
        ],
      },
      {
        slug: 'common-problems',
        title: { es: 'Problemas comunes y como resolverlos', en: 'Common problems and how to solve them' },
        excerpt: { es: 'Pasos rapidos para login, permisos, mensajes, notificaciones y pantalla.', en: 'Quick steps for login, permissions, messages, notifications, and display issues.' },
        body: [
          { type: 'h', text: { es: 'No puedo entrar', en: 'I cannot sign in' } },
          { type: 'ul', items: [
            { es: 'Revisa mayusculas, contrasena y usuario/correo.', en: 'Check capitalization, password, and username/email.' },
            { es: 'Confirma con el administrador que tu cuenta este activa.', en: 'Confirm with the administrator that your account is active.' },
            { es: 'Si estabas inactivo, vuelve a iniciar sesion.', en: 'If you were inactive, sign in again.' },
          ] },
          { type: 'h', text: { es: 'No veo una pantalla', en: 'I cannot see a screen' } },
          { type: 'ul', items: [
            { es: 'Confirma que estas en la clinica correcta.', en: 'Confirm you are in the correct clinic.' },
            { es: 'Pide al administrador revisar rol, permisos y menu lateral.', en: 'Ask the administrator to review role, permissions, and side rail.' },
            { es: 'Cierra e inicia sesion despues de cambios de permisos.', en: 'Sign out and back in after permission changes.' },
          ] },
          { type: 'h', text: { es: 'No llegan mensajes o alertas', en: 'Messages or alerts do not arrive' } },
          { type: 'ul', items: [
            { es: 'Revisa estado del canal en Admin Studio > Canales.', en: 'Check channel status in Admin Studio > Channels.' },
            { es: 'Verifica que tus alertas esten activadas en Usuarios o Alertas.', en: 'Verify your alerts are enabled in Users or Alerts.' },
            { es: 'Permite notificaciones del navegador si usas push.', en: 'Allow browser notifications if using push.' },
          ] },
          { type: 'note', text: SUPPORT_CHECKLIST },
        ],
      },
      {
        slug: 'when-to-contact-support',
        title: { es: 'Cuando contactar soporte', en: 'When to contact support' },
        excerpt: { es: 'Que informacion enviar para recibir ayuda rapido.', en: 'What information to send to get help quickly.' },
        body: [
          { type: 'p', text: { es: 'Contacta soporte cuando ya revisaste la guia, confirmaste permisos con tu administrador y el problema continua.', en: 'Contact support after you have reviewed the guide, confirmed permissions with your administrator, and the problem continues.' } },
          {
            type: 'ul',
            items: [
              { es: 'Nombre de la clinica y usuario afectado.', en: 'Clinic name and affected user.' },
              { es: 'Pantalla donde ocurre el problema.', en: 'Screen where the problem happens.' },
              { es: 'Que intentabas hacer y que ocurrio.', en: 'What you were trying to do and what happened.' },
              { es: 'Fecha/hora aproximada y canal involucrado, si aplica.', en: 'Approximate date/time and channel involved, if applicable.' },
              { es: 'Captura de pantalla del error visible.', en: 'Screenshot of the visible error.' },
            ],
          },
        ],
      },
    ],
  },
]

export const POPULAR_ARTICLES: { category: string; article: string }[] = [
  { category: 'getting-started', article: 'welcome-to-docmee' },
  { category: 'inbox', article: 'manage-conversations' },
  { category: 'channels', article: 'whatsapp-overview' },
  { category: 'jzel-ai', article: 'meet-jzel' },
  { category: 'admin-studio', article: 'roles-permissions-menu' },
  { category: 'security-troubleshooting', article: 'common-problems' },
]

export function getCategory(slug: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find((c) => c.slug === slug)
}

export function getArticle(categorySlug: string, articleSlug: string) {
  const category = getCategory(categorySlug)
  const article = category?.articles.find((a) => a.slug === articleSlug)
  if (!category || !article) return undefined
  return { category, article }
}

export interface SearchHit {
  category: HelpCategory
  article: HelpArticle
}

const ARTICLE_TARGETS: Record<string, HelpArticleTarget> = {
  'getting-started/welcome-to-docmee': { href: '/inbox', label: { es: 'Abrir Bandeja', en: 'Open Inbox' } },
  'getting-started/install-app-notifications': { href: '/alerts', label: { es: 'Abrir alertas', en: 'Open alerts' } },
  'inbox/manage-conversations': { href: '/inbox', label: { es: 'Abrir Bandeja', en: 'Open Inbox' } },
  'inbox/assignments-statuses-handoff': { href: '/inbox', label: { es: 'Abrir Bandeja', en: 'Open Inbox' } },
  'inbox/voice-notes-media': { href: '/inbox', label: { es: 'Abrir Bandeja', en: 'Open Inbox' } },
  'inbox/internal-notes': { href: '/inbox', label: { es: 'Abrir Bandeja', en: 'Open Inbox' } },
  'appointments/book-appointment': { href: '/calendar', label: { es: 'Abrir Calendario', en: 'Open Calendar' } },
  'appointments/reschedule-cancel-no-show': { href: '/calendar', label: { es: 'Abrir Calendario', en: 'Open Calendar' } },
  'appointments/doctors-services-availability': { href: '/studio/doctors', label: { es: 'Abrir doctores', en: 'Open Doctors' } },
  'channels/whatsapp-overview': { href: '/studio/channels', label: { es: 'Abrir Canales', en: 'Open Channels' } },
  'channels/connect-whatsapp': { href: '/studio/channels', label: { es: 'Abrir Canales', en: 'Open Channels' } },
  'channels/templates-window': { href: '/studio/templates', label: { es: 'Abrir plantillas', en: 'Open Templates' } },
  'jzel-ai/meet-jzel': { href: '/studio/automations', label: { es: 'Abrir J.zel', en: 'Open J.zel' } },
  'jzel-ai/knowledge-base': { href: '/studio/kb', label: { es: 'Abrir base de conocimiento', en: 'Open Knowledge Base' } },
  'jzel-ai/automations-workflows': { href: '/studio/automations', label: { es: 'Abrir automatizaciones', en: 'Open Automations' } },
  'templates/quick-replies': { href: '/studio/templates', label: { es: 'Abrir plantillas', en: 'Open Templates' } },
  'templates/whatsapp-templates': { href: '/studio/templates', label: { es: 'Abrir plantillas', en: 'Open Templates' } },
  'admin-studio/roles-permissions-menu': { href: '/studio/users', label: { es: 'Abrir usuarios', en: 'Open Users' } },
  'admin-studio/manage-users-alerts': { href: '/studio/users', label: { es: 'Abrir usuarios', en: 'Open Users' } },
  'admin-studio/clinic-switching': { href: '/studio', label: { es: 'Abrir Admin Studio', en: 'Open Admin Studio' } },
  'analytics/dashboards': { href: '/analytics', label: { es: 'Abrir metricas', en: 'Open Analytics' } },
  'analytics/reports-quality': { href: '/reports', label: { es: 'Abrir reportes', en: 'Open Reports' } },
  'security-troubleshooting/common-problems': { href: '/studio/channels', label: { es: 'Revisar canales', en: 'Check Channels' } },
  'security-troubleshooting/when-to-contact-support': { href: '/help', label: { es: 'Volver al centro de ayuda', en: 'Back to Help Center' } },
}

export function getArticleTarget(categorySlug: string, articleSlug: string): HelpArticleTarget | undefined {
  return ARTICLE_TARGETS[`${categorySlug}/${articleSlug}`]
}

export function searchArticles(query: string): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const category of HELP_CATEGORIES) {
    for (const article of category.articles) {
      const haystack = [
        category.title.es,
        category.title.en,
        category.description.es,
        category.description.en,
        article.title.es,
        article.title.en,
        article.excerpt.es,
        article.excerpt.en,
        ...article.body.flatMap((b) => {
          if (b.type === 'ul' || b.type === 'steps') return b.items.flatMap((i) => [i.es, i.en])
          if (b.type === 'video') return [b.title.es, b.title.en, b.caption?.es ?? '', b.caption?.en ?? '']
          return [b.text.es, b.text.en]
        }),
      ]
        .join(' ')
        .toLowerCase()
      if (haystack.includes(q)) hits.push({ category, article })
    }
  }
  return hits
}

export function helpAsText(lang: PanelLanguage): string {
  const out: string[] = []
  for (const cat of HELP_CATEGORIES) {
    out.push(`## ${L(cat.title, lang)}`)
    out.push(L(cat.description, lang))
    for (const art of cat.articles) {
      out.push(`### ${L(art.title, lang)}`)
      out.push(L(art.excerpt, lang))
      for (const block of art.body) {
        if (block.type === 'ul') {
          out.push(block.items.map((i) => `- ${L(i, lang)}`).join('\n'))
        } else if (block.type === 'steps') {
          out.push(block.items.map((i, n) => `${n + 1}. ${L(i, lang)}`).join('\n'))
        } else if (block.type === 'video') {
          out.push(`${L(block.title, lang)}${block.caption ? ` - ${L(block.caption, lang)}` : ''}`)
        } else {
          out.push(L(block.text, lang))
        }
      }
    }
  }
  return out.join('\n')
}
