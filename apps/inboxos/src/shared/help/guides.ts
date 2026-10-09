import type { HelpArticleTarget, HelpCategory, Localized } from './content'

const text = (en: string, es: string): Localized => ({ en, es })

export const NEW_FEATURE_GUIDES: HelpCategory = {
  slug: 'new-features', icon: 'kb',
  title: text('Using the latest features', 'Cómo usar las nuevas funciones'),
  description: text('Practical guides for scheduling, workflows, clinic knowledge, AI, and administrative controls.', 'Guías prácticas de programación, flujos, conocimiento clínico, IA y controles administrativos.'),
  articles: [
    {
      slug: 'scheduled-messages',
      title: text('Schedule and manage WhatsApp messages', 'Programar y gestionar mensajes de WhatsApp'),
      excerpt: text('Prepare a message for later, check its timezone, and manage pending delivery safely.', 'Prepara un mensaje para después, revisa su zona horaria y gestiona el envío pendiente con seguridad.'),
      body: [
        { type: 'note', text: text('Controlled rollout: scheduling must be enabled for your clinic and operational checks must pass. If the scheduling control is unavailable, ask an administrator to check enablement and your permissions. Do not assume that scheduling is active merely because it appears in Help.', 'Lanzamiento controlado: la programación debe estar habilitada para tu clínica y superar las verificaciones operativas. Si el control no está disponible, pide al administrador que revise la habilitación y tus permisos. Que aparezca en Ayuda no significa que esté activa.') },
        { type: 'steps', items: [
          text('Open the intended WhatsApp conversation in the selected clinic. Confirm the recipient and permission to contact them.', 'Abre la conversación de WhatsApp correcta en la clínica seleccionada. Confirma el destinatario y el permiso para contactarlo.'),
          text('Use the scheduling control to prepare text or a supported approved static template. Select a future date and time in the clinic timezone, not an assumed computer timezone.', 'Usa el control de programación para preparar texto o una plantilla estática aprobada compatible. Elige fecha y hora futuras en la zona horaria de la clínica, sin asumir la zona de tu computadora.'),
          text('Review the recipient, content, and delivery time before confirming. Check the scheduled-message panel for its status.', 'Revisa destinatario, contenido y hora de envío antes de confirmar. Consulta su estado en el panel de mensajes programados.'),
          text('Edit or cancel while the message is still pending. Once sending begins, changes may no longer be allowed.', 'Edita o cancela mientras el mensaje siga pendiente. Una vez iniciado el envío, puede que ya no se permitan cambios.'),
        ] },
        { type: 'p', text: text('At delivery time, Docmee rechecks access, consent, conversation state, channel connection, and WhatsApp eligibility. Free text needs an eligible customer-care window; outside that window an approved template is required. A message scheduled now is not a guarantee of later delivery.', 'Al enviar, Docmee vuelve a verificar acceso, consentimiento, estado de conversación, conexión del canal y elegibilidad en WhatsApp. El texto libre necesita una ventana de atención válida; fuera de ella se requiere una plantilla aprobada. Programar ahora no garantiza el envío posterior.') },
        { type: 'note', text: text('Scheduling alone does not pause the bot. If delivery is uncertain, review the status before sending again: Docmee does not automatically resend uncertain deliveries, to avoid duplicates.', 'Programar no pausa el bot. Si el envío es incierto, revisa su estado antes de volver a enviar: Docmee no reenvía automáticamente los envíos inciertos para evitar duplicados.') },
      ],
    },
    {
      slug: 'cleaner-workflow-builder',
      title: text('Build and navigate cleaner workflows', 'Crear y navegar flujos más claros'),
      excerpt: text('Use groups, focused routes, layout tools, and Problems without changing the underlying connections.', 'Usa grupos, rutas enfocadas, herramientas de distribución y Problemas sin cambiar las conexiones reales.'),
      body: [
        { type: 'steps', items: [
          text('In Admin Studio → Workflows, verify the selected clinic. Search and filter the workflow list by status, then open the intended workflow.', 'En Admin Studio → Flujos, verifica la clínica seleccionada. Busca y filtra la lista por estado y abre el flujo correcto.'),
          text('Organize related steps into visual groups. Collapse groups to reduce clutter; grouped connection summaries represent the original connections rather than deleting them.', 'Organiza pasos relacionados en grupos visuales. Contrae los grupos para reducir el ruido; los resúmenes de conexiones representan las conexiones originales, no las eliminan.'),
          text('Use route focus to inspect a branch and the layout tools to arrange steps. Expand a group to inspect its individual steps and connections.', 'Usa el enfoque de ruta para revisar una rama y las herramientas de distribución para ordenar los pasos. Expande un grupo para inspeccionar cada paso y conexión.'),
          text('Review red and amber badges and the Problems list. Correct missing configuration or connections, save, and check the save feedback before publishing.', 'Revisa las marcas rojas y ámbar y la lista de Problemas. Corrige configuración o conexiones faltantes, guarda y revisa el resultado antes de publicar.'),
        ] },
        { type: 'note', text: text('Saving a draft and publishing a workflow are different actions. Confirm the published version and status for the correct clinic. A clean layout is not proof that live execution works.', 'Guardar un borrador y publicar un flujo son acciones distintas. Confirma la versión publicada y el estado en la clínica correcta. Una distribución clara no demuestra que la ejecución real funcione.') },
        { type: 'p', text: text('The simulator is hidden until opened with Simulate and can be hidden again. It uses mocked providers: it does not send patient messages, create appointments, or prove a live integration is ready.', 'El simulador permanece oculto hasta abrirlo con Simular y puede volver a ocultarse. Usa proveedores simulados: no envía mensajes a pacientes, no crea citas ni demuestra que una integración real esté lista.') },
      ],
    },
    {
      slug: 'workflow-diagnostics',
      title: text('Diagnose a workflow safely', 'Diagnosticar un flujo con seguridad'),
      excerpt: text('Superusers can inspect saved workflows, preview edits, and review redacted execution evidence.', 'Los superusuarios pueden revisar flujos guardados, previsualizar cambios y consultar evidencia de ejecución redactada.'),
      body: [
        { type: 'note', text: text('Workflow diagnostics are available only to superusers, not every clinic administrator. Normal workflow editing permissions do not grant diagnostic access.', 'Los diagnósticos de flujos solo están disponibles para superusuarios, no para todos los administradores de clínica. Poder editar flujos no concede acceso al diagnóstico.') },
        { type: 'steps', items: [
          text('Select the clinic and workflow, then open Diagnostics. Check whether you are diagnosing the saved workflow or previewing unsaved editor changes.', 'Selecciona clínica y flujo y abre Diagnósticos. Comprueba si estás revisando el flujo guardado o previsualizando cambios sin guardar.'),
          text('Review structural problems, configured routes, readiness results, and recent redacted execution evidence. Start with the first failing step rather than changing unrelated branches.', 'Revisa problemas estructurales, rutas configuradas, resultados de preparación y evidencia reciente redactada. Empieza por el primer paso fallido, sin cambiar ramas ajenas.'),
          text('Fix the specific issue, save, and run the safe preview again. Verify publication and clinic selection separately from the preview.', 'Corrige el problema concreto, guarda y vuelve a ejecutar la previsualización segura. Verifica publicación y clínica por separado de la previsualización.'),
        ] },
        { type: 'note', text: text('Unknown readiness is not a passed check. Safe diagnostics do not contact patients or external services. A successful mock preview still requires separate authorized live verification when an integration is involved.', 'Un estado de preparación desconocido no es una verificación aprobada. Los diagnósticos seguros no contactan pacientes ni servicios externos. Una previsualización simulada correcta requiere una verificación real autorizada por separado si hay integraciones.') },
      ],
    },
    {
      slug: 'knowledge-approval-retrieval',
      title: text('Import, approve, and reuse clinic knowledge', 'Importar, aprobar y reutilizar conocimiento clínico'),
      excerpt: text('Canonical Markdown, approval, indexing, and scoped retrieval keep patient answers grounded.', 'Markdown canónico, aprobación, indexación y recuperación con alcance mantienen las respuestas fundamentadas.'),
      body: [
        { type: 'steps', items: [
          text('Open Clinic KB for the selected clinic. Add a fact or upload a supported document or image; inspect the extracted content rather than trusting the filename.', 'Abre Clinic KB para la clínica seleccionada. Añade un dato o sube un documento o imagen compatible; revisa el contenido extraído en lugar de confiar en el nombre del archivo.'),
          text('Imported content is converted to canonical Markdown (.md). The non-Markdown original is removed after successful canonical storage. Review formatting, tables, and extracted image text; failed conversion is not approved knowledge.', 'El contenido importado se convierte a Markdown canónico (.md). El original no Markdown se elimina después de guardar correctamente el contenido canónico. Revisa formato, tablas y texto extraído de imágenes; una conversión fallida no es conocimiento aprobado.'),
          text('Set the intended clinic, doctor scope, and language. Review the draft for accuracy, outdated facts, conflicts, and unnecessary personal information before approving.', 'Define clínica, alcance por doctor e idioma. Revisa precisión, datos obsoletos, conflictos e información personal innecesaria antes de aprobar el borrador.'),
          text('Check approval and indexing status. An uploaded or saved draft is not automatically ready for patient answers. Use an answer preview to check whether the intended approved source is retrieved.', 'Comprueba aprobación e indexación. Un archivo subido o borrador guardado no queda automáticamente listo para responder a pacientes. Usa una previsualización de respuesta para comprobar que se recupera la fuente aprobada correcta.'),
        ] },
        { type: 'p', text: text('J.zel, workflow AI agents, and answer previews share clinic-scoped retrieval. They select relevant passages using semantic and keyword evidence, language, doctor scope, source authority, and approved revisions; they do not read the entire KB for every question.', 'J.zel, los agentes de IA en flujos y las previsualizaciones comparten recuperación limitada a la clínica. Seleccionan pasajes relevantes con evidencia semántica y palabras clave, idioma, alcance por doctor, autoridad de fuente y revisiones aprobadas; no leen toda la KB en cada pregunta.') },
        { type: 'note', text: text('Old information is not excluded merely because it is old: it must still be approved, current, and relevant. Superseded, conflicting, stale, weak, or ungrounded evidence can be withheld and routed to a human. Approval updates reusable knowledge; it does not retrain the AI model itself.', 'La información antigua no se excluye solo por su edad: debe seguir aprobada, vigente y ser relevante. La evidencia reemplazada, contradictoria, obsoleta, débil o sin fundamento puede retenerse y derivarse a una persona. La aprobación actualiza conocimiento reutilizable; no reentrena el modelo de IA.') },
      ],
    },
    {
      slug: 'train-jzel',
      title: text('Train J.zel with approved clinic facts', 'Entrenar a J.zel con datos clínicos aprobados'),
      excerpt: text('Superusers can propose a fact or correction; approved knowledge remains reusable by clinic agents.', 'Los superusuarios pueden proponer datos o correcciones; el conocimiento aprobado sigue siendo reutilizable por los agentes de la clínica.'),
      body: [
        { type: 'note', text: text('The Train J.zel button is for superusers only. Non-superusers may still receive answers using approved clinic knowledge, according to their permissions; hiding training does not disable approved learning.', 'El botón Train J.zel es solo para superusuarios. Los demás usuarios pueden recibir respuestas basadas en conocimiento clínico aprobado según sus permisos; ocultar el entrenamiento no desactiva ese conocimiento.') },
        { type: 'steps', items: [
          text('Open J.zel and choose Train J.zel. Confirm the teaching clinic, doctor scope, and language before entering a fact or correction.', 'Abre J.zel y elige Train J.zel. Confirma clínica de enseñanza, alcance por doctor e idioma antes de introducir un dato o corrección.'),
          text('Choose whether to add a new entry or update an existing one. Review the private draft and approve it only after checking the underlying fact.', 'Elige añadir una entrada o actualizar una existente. Revisa el borrador privado y apruébalo solo después de comprobar el dato original.'),
          text('Refresh status and confirm approval and indexing. Use revision history or restore where available if a correction needs to be undone, then verify the active revision.', 'Actualiza el estado y confirma aprobación e indexación. Usa historial de revisiones o restauración cuando esté disponible si necesitas deshacer una corrección y verifica la revisión activa.'),
        ] },
        { type: 'p', text: text('J.zel is bounded to the selected clinic’s KB and AI settings. Switching clinics must not reuse another clinic’s knowledge. Do not enter patient details when teaching general clinic facts.', 'J.zel está limitado a la KB y configuración de IA de la clínica seleccionada. Cambiar de clínica no debe reutilizar conocimiento de otra clínica. No introduzcas datos de pacientes al enseñar información general.') },
      ],
    },
    {
      slug: 'workflow-ai-agent',
      title: text('Use the AI Agent node and clinic AI settings', 'Usar el nodo AI Agent y la configuración de IA clínica'),
      excerpt: text('Connect a controlled AI response to a workflow while keeping provider choice and knowledge scoped to the clinic.', 'Conecta una respuesta de IA controlada al flujo, manteniendo proveedor y conocimiento limitados a la clínica.'),
      body: [
        { type: 'steps', items: [
          text('Check Admin Studio → AI Settings for the intended clinic. Provider and model selection, including configured OpenAI or Claude services, follow the clinic settings and supported credentials.', 'Revisa Admin Studio → AI Settings para la clínica correcta. La selección de proveedor y modelo, incluidos servicios OpenAI o Claude configurados, sigue los ajustes de la clínica y las credenciales compatibles.'),
          text('Add or configure the AI Agent action in the workflow. Connect its reply and fallback or handoff routes so a failed or unsupported answer does not strand the conversation.', 'Añade o configura la acción AI Agent en el flujo. Conecta sus rutas de respuesta y alternativa o derivación para que una respuesta fallida o no respaldada no deje la conversación bloqueada.'),
          text('Test a saved AI Agent node using approved KB evidence and inspect the preview. Verify the published workflow separately before using an authorized live test.', 'Prueba un nodo AI Agent guardado con evidencia de la KB aprobada y revisa la previsualización. Verifica el flujo publicado por separado antes de una prueba real autorizada.'),
        ] },
        { type: 'note', text: text('An AI node is not permission to bypass KB approval, clinic isolation, human handoff, or channel safeguards. Previewing does not send patient messages. Managed CLI transport is not a patient-facing service enabled by this guide.', 'Un nodo de IA no autoriza omitir aprobación de KB, aislamiento de clínica, derivación humana ni controles del canal. La previsualización no envía mensajes a pacientes. El transporte CLI administrado no es un servicio para pacientes habilitado por esta guía.') },
      ],
    },
    {
      slug: 'inbox-booking-updates',
      title: text('Updated inbox, media, and appointment handling', 'Bandeja, archivos y gestión de citas actualizados'),
      excerpt: text('Find conversations, share media, and verify booking details and calendar integration.', 'Encuentra conversaciones, comparte archivos y verifica datos de citas e integración de calendario.'),
      body: [
        { type: 'ul', items: [
          text('Inbox filters are All / Secretary / Bot / Assigned. Use All if a conversation is not visible under a narrower filter. Check clinic selection before assuming a conversation is missing.', 'Los filtros son All / Secretary / Bot / Assigned. Usa All si una conversación no aparece con un filtro más específico. Revisa la clínica antes de asumir que falta una conversación.'),
          text('Open the media repository with its library icon. Select up to 10 files, within the displayed 100 MB total limit. Docmee Files and Google Drive depend on the configured storage or integration.', 'Abre el repositorio de archivos con su icono de biblioteca. Selecciona hasta 10 archivos dentro del límite mostrado de 100 MB en total. Docmee Files y Google Drive dependen del almacenamiento o integración configurados.'),
          text('For bookings, collect and verify the patient’s name, email, and phone along with the doctor, service, date, and time. Recheck the saved appointment instead of assuming the chat text was stored.', 'Para reservar, recoge y verifica nombre, correo y teléfono del paciente, además de doctor, servicio, fecha y hora. Revisa la cita guardada en vez de asumir que se almacenó el texto del chat.'),
          text('Use the appointment’s reschedule or cancel action for changes. If Google Calendar is connected and synchronization succeeds, verify the corresponding event and its captured details there too; a Docmee booking alone is not proof of successful external sync.', 'Usa la acción de reprogramar o cancelar de la cita para cambios. Si Google Calendar está conectado y la sincronización termina correctamente, verifica también el evento y los datos capturados; una reserva en Docmee no demuestra por sí sola una sincronización externa correcta.'),
        ] },
        { type: 'note', text: text('Whole-chat deletion requires the permitted role and confirmation, including password confirmation where prompted. It removes the selected conversation history; do not use it to close or assign a conversation. Cancel/End in a workflow is not the same as opting a patient out.', 'Eliminar un chat completo requiere el rol permitido y confirmación, incluida contraseña cuando se solicite. Elimina el historial seleccionado; no lo uses para cerrar o asignar conversaciones. Cancel/End en un flujo no equivale a dar de baja al paciente.') },
      ],
    },
    {
      slug: 'clinic-readiness-hours',
      title: text('Check clinic readiness and business-hour controls', 'Revisar preparación clínica y controles de horario'),
      excerpt: text('Resolve setup warnings and understand when the bot is allowed to answer.', 'Resuelve avisos de configuración y comprende cuándo puede responder el bot.'),
      body: [
        { type: 'steps', items: [
          text('Check the setup banner and notification bell after changing clinic configuration. Review missing hours, disconnected channels, broken published workflows, or multiple responders.', 'Revisa el aviso de configuración y la campana después de cambiar ajustes. Comprueba horarios faltantes, canales desconectados, flujos publicados con errores o varios respondedores.'),
          text('Confirm business hours and the clinic timezone. The default business-hour guard permits bot responses outside configured hours; the clinic’s explicit allow-during-business-hours setting changes that behavior.', 'Confirma horarios y zona horaria clínica. El control predeterminado permite respuestas del bot fuera de los horarios configurados; el ajuste explícito de permitir durante horario laboral cambia ese comportamiento.'),
          text('Check automation opt-in or opt-out and human handoff state for the conversation. These controls and channel eligibility still apply even when a workflow is published.', 'Comprueba activación o desactivación de automatización y estado de derivación humana de la conversación. Estos controles y la elegibilidad del canal siguen aplicándose aunque el flujo esté publicado.'),
        ] },
        { type: 'note', text: text('A warning is a prompt to check the specific configuration, not to disable safeguards globally. If the reply looks like a different workflow, confirm the clinic, published version, matching trigger, and recent execution evidence before changing the graph.', 'Un aviso indica revisar una configuración concreta, no desactivar todos los controles. Si la respuesta parece de otro flujo, confirma clínica, versión publicada, disparador coincidente y evidencia reciente antes de cambiar el diagrama.') },
      ],
    },
    {
      slug: 'product-updates-change-log',
      title: text('Follow Product updates and the administrative Change log', 'Consultar Actualizaciones del producto e historial administrativo'),
      excerpt: text('Distinguish published feature announcements from administrative audit evidence.', 'Distingue anuncios de funciones publicadas de evidencia de auditoría administrativa.'),
      body: [
        { type: 'ul', items: [
          text('Use the Product updates icon or sidebar entry to open What’s New and All Features. Announcements and feature visibility depend on your role; a notification is not a change to your permissions.', 'Usa el icono o entrada lateral de Actualizaciones del producto para abrir Novedades y Todas las funciones. Los anuncios y funciones visibles dependen de tu rol; una notificación no cambia tus permisos.'),
          text('Help now includes the same curated release notes and feature catalog. Future catalog updates appear in Help when that release is deployed, without a separate copied release-note entry.', 'Ayuda incluye ahora las mismas notas de versión y catálogo de funciones. Las futuras actualizaciones del catálogo aparecen en Ayuda al desplegar esa versión, sin copiar otra entrada de notas.'),
          text('Superusers can open Admin Studio → Compliance → Change log and filter by clinic, area, outcome, or text. Inspect before/after records and failed attempts when troubleshooting administrative changes.', 'Los superusuarios pueden abrir Admin Studio → Compliance → Change log y filtrar por clínica, área, resultado o texto. Revisa registros antes/después e intentos fallidos al investigar cambios administrativos.'),
        ] },
        { type: 'note', text: text('The Change log is superuser-only; Help and Product updates do not grant audit access. Audit records do not store secret values. Do not include credentials or patient information in support screenshots.', 'El historial es solo para superusuarios; Ayuda y Actualizaciones no conceden acceso a auditoría. Los registros no almacenan valores secretos. No incluyas credenciales ni información de pacientes en capturas de soporte.') },
      ],
    },
  ],
}

export const NEW_FEATURE_TARGETS: Record<string, HelpArticleTarget> = Object.fromEntries([
  ['scheduled-messages', '/inbox'], ['cleaner-workflow-builder', '/studio/workflows'],
  ['workflow-diagnostics', '/studio/workflows'], ['knowledge-approval-retrieval', '/studio/kb'],
  ['train-jzel', '/inbox'], ['workflow-ai-agent', '/studio/ai-settings'],
  ['inbox-booking-updates', '/inbox'], ['clinic-readiness-hours', '/studio/clinics'],
  ['product-updates-change-log', '/updates'],
].map(([slug, href]) => [`new-features/${slug}`, { href, label: text('Open in Docmee', 'Abrir en Docmee') }]))
