'use client'

import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'

type Props = {
  children: ReactNode
  language: 'en' | 'es'
}

const exactTranslations: Record<string, string> = {
  'A local build workbench for prompts, gates, diagnostics, agents, cost, deployment, and Discord routing.': 'Un panel local para prompts, controles, diagnosticos, agentes, costos, despliegue y rutas de Discord.',
  'Add Backlog Task': 'Agregar tarea pendiente',
  'Add task': 'Agregar tarea',
  'All gates passed': 'Todos los controles pasaron',
  'All ready prompts are cached and usable.': 'Todos los prompts listos estan guardados y se pueden usar.',
  'Automated build watcher started': 'Monitor de compilacion automatica iniciado',
  'Backend builder': 'Constructor backend',
  'Build Control': 'Control de compilacion',
  'Build Progress': 'Progreso de compilacion',
  'Build output is written to /tools/logs/phase-YYYY-MM-DD.log.': 'La salida de compilacion se escribe en /tools/logs/phase-YYYY-MM-DD.log.',
  'Build progress': 'Progreso de compilacion',
  'Build stopped': 'Compilacion detenida',
  'Check Build Running': 'Comprobar si la compilacion esta activa',
  'Claude Code build started': 'Compilacion con Claude Code iniciada',
  'Claude Code is working': 'Claude Code esta trabajando',
  'Claude Pro': 'Claude Pro',
  'Configuration': 'Configuracion',
  'Connected': 'Conectado',
  'Current phase': 'Fase actual',
  'Current step': 'Paso actual',
  'Current workspace': 'Espacio de trabajo actual',
  'Dashboard package found.': 'Paquete del panel encontrado.',
  'Deploy command completed': 'Comando de despliegue completado',
  'Deploy to VPS': 'Desplegar al VPS',
  'DevTools is ready': 'DevTools esta listo',
  'Diagnostics': 'Diagnosticos',
  'Discord messaging is configured.': 'La mensajeria de Discord esta configurada.',
  'Dry Run': 'Prueba en seco',
  'Dry run passed. Start can launch without hidden setup work.': 'La prueba en seco paso. El inicio puede ejecutarse sin preparacion oculta.',
  'Failed': 'Fallo',
  'Failures': 'Fallos',
  'Full automation for all 19 phases through Claude Code.': 'Automatizacion completa de las 19 fases mediante Claude Code.',
  'GitHub remote is reachable.': 'El remoto de GitHub esta disponible.',
  'Heartbeat': 'Latido',
  'How to continue': 'Como continuar',
  'Install Monitor': 'Monitor de instalacion',
  'Launch Application': 'Abrir aplicacion',
  'Launch application for checking': 'Abrir aplicacion para revisar',
  'Final deployment to VPS': 'Despliegue final al VPS',
  'Live build process': 'Proceso de compilacion activo',
  'Mark Done': 'Marcar listo',
  'Needs attention': 'Requiere atencion',
  'Next Best Action': 'Siguiente mejor accion',
  'No active build watcher': 'No hay monitor de compilacion activo',
  'No current note.': 'No hay nota actual.',
  'No live process detected': 'No se detecto proceso activo',
  'No phase': 'Sin fase',
  'No recent activity.': 'Sin actividad reciente.',
  'No placeholder ready prompts detected.': 'No se detectaron prompts listos de marcador de posicion.',
  'Not checked': 'No comprobado',
  'Not passed': 'No aprobado',
  'Not running': 'No esta activo',
  'Open Build Control': 'Abrir Control de compilacion',
  'Open Notion spec': 'Abrir especificacion en Notion',
  'Open Ready Check': 'Abrir comprobacion de preparacion',
  'Open Ready Details': 'Abrir detalles de preparacion',
  'Open in Notion': 'Abrir en Notion',
  'Operations console': 'Consola de operaciones',
  'Passed': 'Aprobado',
  'Paused until Claude refresh': 'Pausado hasta actualizar Claude',
  'Phase Progress': 'Progreso de fases',
  'Phase Timeline': 'Linea de tiempo de fases',
  'Phase build command completed': 'Comando de compilacion de fase completado',
  'Phases complete': 'Fases completadas',
  'Polling check': 'Comprobacion de sondeo',
  'Post-Deployment Log': 'Registro post-despliegue',
  'Issues found after development and before VPS deployment.': 'Problemas encontrados despues del desarrollo y antes del despliegue al VPS.',
  'Prepare Context': 'Preparar contexto',
  'Prompt Sync Status': 'Estado de sincronizacion de prompts',
  'Ready Check': 'Comprobacion de preparacion',
  'Ready Check passed. Claude Pro, Notion, GitHub, prompts, and Discord are usable.': 'La comprobacion de preparacion paso. Claude Pro, Notion, GitHub, los prompts y Discord estan listos para usarse.',
  'Ready checks': 'Comprobaciones de preparacion',
  'Reachable': 'Disponible',
  'Recent Activity': 'Actividad reciente',
  'Re-run Gates': 'Ejecutar controles otra vez',
  'Resume from': 'Reanudar desde',
  'Review Settings': 'Revisar configuracion',
  'Run Start Check': 'Ejecutar comprobacion de inicio',
  'Run Functionality Check': 'Ejecutar comprobacion de funcionalidades',
  'Run before build': 'Ejecutar antes de compilar',
  'Running': 'Activo',
  'Safe Build Test': 'Prueba segura de compilacion',
  'Safe Start Check passed for': 'Comprobacion segura de inicio aprobada para',
  'Setup Check': 'Comprobacion de configuracion',
  'Stack intelligence': 'Inteligencia del stack',
  'Start Automated Build': 'Iniciar compilacion automatica',
  'Start': 'Iniciar',
  'Start Build Control': 'Iniciar Control de compilacion',
  'Start Check': 'Comprobacion de inicio',
  'Start Readiness needs a check': 'La preparacion de inicio necesita comprobacion',
  'Start Readiness passed': 'Preparacion de inicio aprobada',
  'Stop Build': 'Detener compilacion',
  'Stopped': 'Detenido',
  'Supporting Tools': 'Herramientas de soporte',
  'Sync from Notion': 'Sincronizar desde Notion',
  'Typecheck passed.': 'La comprobacion de tipos paso.',
  'Updated': 'Actualizado',
  'Latest Functionality Check': 'Ultima comprobacion de funcionalidades',
  'Current Issues': 'Problemas actuales',
  'No current issues from the latest check.': 'No hay problemas actuales en la ultima comprobacion.',
  'Run the check to create the first log.': 'Ejecuta la comprobacion para crear el primer registro.',
  'No post-deployment checks have been recorded yet.': 'Todavia no se han registrado comprobaciones post-despliegue.',
  'No history yet.': 'Todavia no hay historial.',
  'Functionality': 'Funcionalidad',
  'Result': 'Resultado',
  'Last run': 'Ultima ejecucion',
  'Waiting': 'En espera',
  'Waiting for heartbeat': 'Esperando latido',
  'Warnings': 'Advertencias',
  'Available after all 19 build phases are complete.': 'Disponible cuando las 19 fases de compilacion esten completas.',
  'Requests the VPS deployment plan and posts a critical Discord confirmation.': 'Solicita el plan de despliegue al VPS y publica una confirmacion critica en Discord.',
  'Starts the local app, opens the Inbox UI, and uses the demo login.': 'Inicia la aplicacion local, abre Inbox UI y usa el acceso demo.',
  'Target: VPS/domain from Settings': 'Destino: VPS/dominio desde Configuracion',
  'Type: production deployment request': 'Tipo: solicitud de despliegue de produccion',
  'Open Deploy page': 'Abrir pagina de despliegue',
  'Open Post-Deployment Log': 'Abrir registro post-despliegue',
  'Run Runtime Check': 'Ejecutar comprobacion de runtime',
  'Local Deployment Runtime': 'Runtime de despliegue local',
  'These dependencies are required after the build and before VPS deployment.': 'Estas dependencias son necesarias despues de la compilacion y antes del despliegue al VPS.',
  'Docker engine': 'Motor Docker',
  'Postgres port': 'Puerto Postgres',
  'Redis port': 'Puerto Redis',
  'API health': 'Estado de API',
  'Demo login': 'Acceso demo',
  'Runs local Postgres and Redis containers.': 'Ejecuta contenedores locales de Postgres y Redis.',
  'Database required for login and app data.': 'Base de datos requerida para acceso y datos de la aplicacion.',
  'Queue/cache runtime used by background jobs.': 'Runtime de cola/cache usado por trabajos en segundo plano.',
  'Confirms the local API can respond.': 'Confirma que la API local responde.',
  'Confirms seeded test credentials work.': 'Confirma que las credenciales demo funcionan.',
  'build progress': 'progreso de compilacion',
  'commit': 'commit',
  'critical issues': 'problemas criticos',
  'not prepared': 'no preparado',
  'not synced': 'no sincronizado',
  'not updated': 'sin actualizar',
  'not yet': 'todavia no',
  'done': 'listo',
  'in-progress': 'en progreso',
  'not-started': 'no iniciado',
  'pending': 'pendiente',
  'ready': 'listo',
  'updated': 'actualizado',
  'warnings': 'advertencias'
}

const wordTranslations: Record<string, string> = {
  active: 'activo',
  Active: 'Activo',
  Accepted: 'Aceptado',
  Account: 'Cuenta',
  Accounts: 'Cuentas',
  Action: 'Accion',
  Actions: 'Acciones',
  Add: 'Agregar',
  Admin: 'Admin',
  After: 'Despues',
  Agents: 'Agentes',
  All: 'Todo',
  Application: 'Aplicacion',
  Approval: 'Aprobacion',
  Approved: 'Aprobado',
  Area: 'Area',
  Audit: 'Auditoria',
  Automated: 'Automatizado',
  Automation: 'Automatizacion',
  Available: 'Disponible',
  Backlog: 'Pendientes',
  Backend: 'Backend',
  Before: 'Antes',
  Blocker: 'Bloqueo',
  Blockers: 'Bloqueos',
  Bot: 'Bot',
  Build: 'Compilacion',
  Button: 'Boton',
  Calendar: 'Calendario',
  Cached: 'En cache',
  Capture: 'Captura',
  Card: 'Tarjeta',
  Change: 'Cambiar',
  Check: 'Comprobar',
  Checks: 'Comprobaciones',
  Checking: 'Revisando',
  Claude: 'Claude',
  Clear: 'Limpiar',
  Clinic: 'Clinica',
  Clinics: 'Clinicas',
  Code: 'Codigo',
  Complete: 'Completo',
  Completed: 'Completado',
  Cost: 'Costo',
  Configuration: 'Configuracion',
  Connected: 'Conectado',
  Console: 'Consola',
  Continue: 'Continuar',
  Control: 'Control',
  Current: 'Actual',
  Database: 'Base de datos',
  Date: 'Fecha',
  Delay: 'Retraso',
  Delayed: 'Retrasado',
  Delete: 'Eliminar',
  Deploy: 'Desplegar',
  Deployment: 'Despliegue',
  Design: 'Diseno',
  Details: 'Detalles',
  Development: 'Desarrollo',
  Diagnostics: 'Diagnosticos',
  Discord: 'Discord',
  Doctor: 'Doctor',
  Done: 'Listo',
  Dry: 'Seco',
  Empty: 'Vacio',
  English: 'Ingles',
  Error: 'Error',
  Errors: 'Errores',
  Event: 'Evento',
  Events: 'Eventos',
  Exact: 'Exacto',
  Export: 'Exportar',
  Failed: 'Fallo',
  Feature: 'Funcion',
  Features: 'Funciones',
  File: 'Archivo',
  Filter: 'Filtro',
  Final: 'Final',
  Finished: 'Terminado',
  Fix: 'Corregir',
  Frontend: 'Frontend',
  Gates: 'Controles',
  Generated: 'Generado',
  Guide: 'Guia',
  Health: 'Estado',
  Home: 'Inicio',
  Human: 'Humano',
  Idle: 'Inactivo',
  Import: 'Importar',
  Imported: 'Importado',
  Inbox: 'Bandeja',
  Input: 'Entrada',
  Integration: 'Integracion',
  Integrations: 'Integraciones',
  Issue: 'Problema',
  Issues: 'Problemas',
  Item: 'Elemento',
  Items: 'Elementos',
  Label: 'Etiqueta',
  Labels: 'Etiquetas',
  Lane: 'Carril',
  Language: 'Idioma',
  Last: 'Ultimo',
  Latest: 'Mas reciente',
  Launch: 'Abrir',
  Layout: 'Diseno',
  Live: 'Activo',
  Loading: 'Cargando',
  Local: 'Local',
  Log: 'Registro',
  Logs: 'Registros',
  Manual: 'Manual',
  Matrix: 'Matriz',
  Message: 'Mensaje',
  Method: 'Metodo',
  Metrics: 'Metricas',
  Missing: 'Faltante',
  Mobile: 'Movil',
  Model: 'Modelo',
  Monitor: 'Monitor',
  More: 'Mas',
  Name: 'Nombre',
  Needed: 'Necesario',
  Needs: 'Requiere',
  New: 'Nuevo',
  Next: 'Siguiente',
  No: 'No',
  Note: 'Nota',
  Notes: 'Notas',
  Notion: 'Notion',
  Offline: 'Sin conexion',
  Open: 'Abrir',
  Operations: 'Operaciones',
  Output: 'Salida',
  Overview: 'Resumen',
  Page: 'Pagina',
  Passed: 'Aprobado',
  Patient: 'Paciente',
  Pending: 'Pendiente',
  Permission: 'Permiso',
  Phase: 'Fase',
  Planned: 'Planificado',
  Pre: 'Pre',
  Priority: 'Prioridad',
  Process: 'Proceso',
  Product: 'Producto',
  Progress: 'Progreso',
  Halted: 'Detenido',
  Heartbeat: 'Latido',
  Progressing: 'Avanzando',
  Prompt: 'Prompt',
  Prompts: 'Prompts',
  Queue: 'Cola',
  Ready: 'Listo',
  Record: 'Registro',
  Recorded: 'Registrado',
  Records: 'Registros',
  Refresh: 'Actualizar',
  Report: 'Reporte',
  Required: 'Requerido',
  Reset: 'Restablecer',
  Response: 'Respuesta',
  Result: 'Resultado',
  Resume: 'Reanudar',
  Review: 'Revisar',
  Run: 'Ejecutar',
  Running: 'Activo',
  Safe: 'Seguro',
  Scan: 'Escaneo',
  Screen: 'Pantalla',
  Screens: 'Pantallas',
  Secretary: 'Secretaria',
  Session: 'Sesion',
  Sessions: 'Sesiones',
  Set: 'Definir',
  Settings: 'Configuracion',
  Source: 'Origen',
  Spanish: 'Espanol',
  Start: 'Iniciar',
  Started: 'Iniciado',
  State: 'Estado',
  States: 'Estados',
  Status: 'Estado',
  Step: 'Paso',
  Steps: 'Pasos',
  Stop: 'Detener',
  Stopped: 'Detenido',
  Success: 'Exito',
  Summary: 'Resumen',
  Sync: 'Sincronizar',
  Synced: 'Sincronizado',
  Switch: 'Cambiar',
  Table: 'Tabla',
  Target: 'Destino',
  Task: 'Tarea',
  Tasks: 'Tareas',
  Test: 'Prueba',
  Time: 'Hora',
  Timestamp: 'Fecha y hora',
  Tokens: 'Tokens',
  Tool: 'Herramienta',
  Tools: 'Herramientas',
  Total: 'Total',
  Traceability: 'Trazabilidad',
  Type: 'Tipo',
  UI: 'UI',
  Unknown: 'Desconocido',
  Update: 'Actualizar',
  Updated: 'Actualizado',
  Updates: 'Actualizaciones',
  Usage: 'Uso',
  User: 'Usuario',
  Value: 'Valor',
  Verified: 'Verificado',
  View: 'Vista',
  Visible: 'Visible',
  Waiting: 'En espera',
  Warning: 'Advertencia',
  Warnings: 'Advertencias',
  Working: 'Trabajando',
  Workflow: 'Flujo',
  Workspace: 'Espacio de trabajo',
  accepted: 'aceptado',
  action: 'accion',
  all: 'todo',
  audit: 'auditoria',
  automated: 'automatizado',
  available: 'disponible',
  backend: 'backend',
  blockers: 'bloqueos',
  build: 'compilacion',
  button: 'boton',
  check: 'comprobacion',
  checks: 'comprobaciones',
  complete: 'completo',
  completed: 'completado',
  connected: 'conectado',
  cost: 'costo',
  current: 'actual',
  deployment: 'despliegue',
  design: 'diseno',
  development: 'desarrollo',
  done: 'listo',
  error: 'error',
  errors: 'errores',
  feature: 'funcion',
  features: 'funciones',
  frontend: 'frontend',
  heartbeat: 'latido',
  lane: 'carril',
  latest: 'mas reciente',
  local: 'local',
  missing: 'faltante',
  mobile: 'movil',
  needed: 'necesario',
  needs: 'requiere',
  next: 'siguiente',
  open: 'abierto',
  pending: 'pendiente',
  phase: 'fase',
  planned: 'planificado',
  priority: 'prioridad',
  progress: 'progreso',
  progressing: 'avanzando',
  queue: 'cola',
  ready: 'listo',
  record: 'registro',
  records: 'registros',
  report: 'reporte',
  review: 'revision',
  running: 'activo',
  screen: 'pantalla',
  screens: 'pantallas',
  source: 'origen',
  start: 'iniciar',
  status: 'estado',
  stopped: 'detenido',
  sync: 'sincronizar',
  synced: 'sincronizado',
  tokens: 'tokens',
  total: 'total',
  updated: 'actualizado',
  warning: 'advertencia',
  warnings: 'advertencias',
  workflow: 'flujo',
  Enhancement: 'Mejora',
  Enhancements: 'Mejoras',
  enhancement: 'mejora',
  enhancements: 'mejoras',
  Verification: 'Verificacion',
  verification: 'verificacion',
  Verify: 'Verificar',
  verify: 'verificar',
  Readiness: 'Preparacion',
  readiness: 'preparacion',
  Resolution: 'Resolucion',
  resolution: 'resolucion',
  Resolve: 'Resolver',
  resolve: 'resolver',
  Resolved: 'Resuelto',
  Mockup: 'Maqueta',
  mockup: 'maqueta',
  Coverage: 'Cobertura',
  coverage: 'cobertura',
  Confidence: 'Confianza',
  confidence: 'confianza',
  Threshold: 'Umbral',
  Recovery: 'Recuperacion',
  Severity: 'Severidad',
  Incident: 'Incidente',
  Integrity: 'Integridad',
  Provider: 'Proveedor',
  Providers: 'Proveedores',
  provider: 'proveedor',
  Routing: 'Enrutamiento',
  Channel: 'Canal',
  Channels: 'Canales',
  channel: 'canal',
  channels: 'canales',
  Reachability: 'Accesibilidad',
  Subsystem: 'Subsistema',
  Subsystems: 'Subsistemas',
  Generate: 'Generar',
  Approve: 'Aprobar',
  Preview: 'Vista previa',
  Commit: 'Confirmar',
  Push: 'Enviar',
  Timeline: 'Cronologia',
  Messages: 'Mensajes',
  Setup: 'Configuracion'
}

const phraseTranslations: Array<[RegExp, string]> = [
  [/\bRun Full Verification\b/g, 'Ejecutar verificacion completa'],
  [/\bFull Verification\b/g, 'Verificacion completa'],
  [/\bContinue to Deploy\b/g, 'Continuar al despliegue'],
  [/\bAuto-resolve all\b/g, 'Resolver todo automaticamente'],
  [/\bAuto-plan & resolve\b/g, 'Auto-planificar y resolver'],
  [/\bLaunch App Locally\b/g, 'Abrir aplicacion localmente'],
  [/\bResolution flow\b/g, 'Flujo de resolucion'],
  [/\bScreen workflow\b/g, 'Flujo de pantallas'],
  [/\bDocmee UI Development\b/g, 'Desarrollo de UI de Docmee'],
  [/\bReadiness Gate\b/g, 'Puerta de preparacion'],
  [/\bFeature automation\b/g, 'Automatizacion de funciones'],
  [/\bEnhancement automation\b/g, 'Automatizacion de mejoras'],
  [/\bLocal app check\b/g, 'Comprobacion de app local'],
  [/\bLocal UI verify\b/g, 'Verificacion de UI local'],
  [/\bGenerate mockup\b/g, 'Generar maqueta'],
  [/\bApprove & build\b/g, 'Aprobar y construir'],
  [/\bCommit & push\b/g, 'Confirmar y enviar'],
  [/\bSetup ready\b/g, 'Configuracion lista'],
  [/\bStart check\b/g, 'Comprobacion de inicio'],
  [/\bPost-deploy\b/g, 'Post-despliegue'],
  [/\bAdd a task\b/g, 'Agregar una tarea'],
  [/\bStart Frontend Development\b/g, 'Iniciar desarrollo frontend'],
  [/\bFrontend Start Check\b/g, 'Comprobacion de inicio frontend'],
  [/\bFrontend Build Control\b/g, 'Control de compilacion frontend'],
  [/\bFeatures Development\b/g, 'Desarrollo de funciones'],
  [/\bFeature Development\b/g, 'Desarrollo de funciones'],
  [/\bDocmee Deployment\b/g, 'Despliegue de Docmee'],
  [/\bBuild Control\b/g, 'Control de compilacion'],
  [/\bReady Check\b/g, 'Comprobacion de preparacion'],
  [/\bStart Check\b/g, 'Comprobacion de inicio'],
  [/\bOpen Ready Details\b/g, 'Abrir detalles de preparacion'],
  [/\bOpen Feature Queue\b/g, 'Abrir cola de funciones'],
  [/\bLaunch Local App\b/g, 'Abrir aplicacion local'],
  [/\bOpen Deploy Guide\b/g, 'Abrir guia de despliegue'],
  [/\bDevelopment Cost\b/g, 'Costo de desarrollo'],
  [/\bStack Intelligence\b/g, 'Inteligencia del stack'],
  [/\bPost-Deployment Log\b/g, 'Registro post-despliegue'],
  [/\bPre-deployment\b/g, 'Pre-despliegue'],
  [/\bDiscord Status\b/g, 'Estado de Discord'],
  [/\bWebhook Console\b/g, 'Consola de webhooks'],
  [/\bSeed Generator\b/g, 'Generador de datos'],
  [/\bInstall Monitor\b/g, 'Monitor de instalacion'],
  [/\bPhase Progress\b/g, 'Progreso de fases'],
  [/\bSix Gates\b/g, 'Seis controles'],
  [/\bClaude Switch\b/g, 'Cambio de Claude'],
  [/\bCodex Switch\b/g, 'Cambio de Codex'],
  [/\bCurrent workspace\b/g, 'Espacio de trabajo actual'],
  [/\bGo back\b/g, 'Volver'],
  [/\bGo forward\b/g, 'Avanzar'],
  [/\bTurn on auto refresh\b/g, 'Activar actualizacion automatica'],
  [/\bTurn off auto refresh\b/g, 'Desactivar actualizacion automatica'],
  [/\bRefresh DevTools view\b/g, 'Actualizar vista de DevTools'],
  [/\bWorking\.\.\./g, 'Trabajando...'],
  [/\bnot running\b/g, 'no esta activo'],
  [/\bnot passed yet\b/g, 'todavia no aprobado'],
  [/\bneeds audit\b/g, 'requiere auditoria'],
  [/\bneed audit\b/g, 'requieren auditoria'],
  [/\baccepted\b/g, 'aceptado'],
  [/\bcomplete\b/g, 'completo'],
  [/\bpending\b/g, 'pendiente'],
  [/\brunning\b/g, 'activo'],
  [/\bpaused\b/g, 'pausado'],
  [/\bstopped\b/g, 'detenido'],
  [/\bfailed\b/g, 'fallo'],
  [/\bwarning\b/g, 'advertencia'],
  [/\bwarnings\b/g, 'advertencias'],
  [/\bblockers\b/g, 'bloqueos'],
  [/\bReady\b/g, 'Listo'],
  [/\bOpen\b/g, 'Abrir'],
  [/\bRun\b/g, 'Ejecutar'],
  [/\bStart\b/g, 'Iniciar'],
  [/\bStop\b/g, 'Detener'],
  [/\bDeploy\b/g, 'Desplegar'],
  [/\bDeployment\b/g, 'Despliegue'],
  [/\bSettings\b/g, 'Configuracion']
]

const originals = new WeakMap<Text, string>()
// API-backed fallback: full-string LLM translations fetched for anything the
// static dictionary does not cover, cached in-memory (server persists to disk).
const apiTranslations = new Map<string, string>()
const requested = new Set<string>()

// Mirror the server's skip rules so we never ship data (hashes, paths, env keys,
// pure numbers) to the translate endpoint.
function looksTranslatable(value: string) {
  const t = value.trim()
  if (t.length < 2 || t.length > 600) return false
  if (!/[A-Za-z]/.test(t)) return false
  if (/^[0-9a-f]{7,40}$/i.test(t)) return false
  if (/^(https?:\/\/|\/|\.\/|~\/|[A-Za-z]:\\)/.test(t)) return false
  if (/^[A-Z0-9_]{3,}$/.test(t) && t.includes('_')) return false
  return true
}

function preserveCase(source: string, translated: string) {
  if (source.toUpperCase() === source && source.length > 1) return translated.toUpperCase()
  if (source[0]?.toUpperCase() === source[0]) return `${translated[0]?.toUpperCase() ?? ''}${translated.slice(1)}`
  return translated
}

function translateWord(word: string) {
  const exact = wordTranslations[word]
  if (exact) return exact
  const lower = word.toLowerCase()
  const translated = wordTranslations[lower]
  return translated ? preserveCase(word, translated) : word
}

function translateWords(value: string) {
  return value.replace(/\b[A-Za-z][A-Za-z'-]*\b/g, (word) => translateWord(word))
}

function translateText(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return value

  const exact = exactTranslations[trimmed]
  if (exact) return value.replace(trimmed, exact)

  const fromApi = apiTranslations.get(trimmed)
  if (fromApi) return value.replace(trimmed, fromApi)

  const resumeMatch = trimmed.match(/^Resume from (P\d{2})$/)
  if (resumeMatch) return value.replace(trimmed, `Reanudar desde ${resumeMatch[1]}`)

  const completeMatch = trimmed.match(/^(\d+)\/(\d+) phases complete$/)
  if (completeMatch) return value.replace(trimmed, `${completeMatch[1]}/${completeMatch[2]} fases completadas`)

  const charsMatch = trimmed.match(/^(\d+) chars$/)
  if (charsMatch) return value.replace(trimmed, `${charsMatch[1]} caracteres`)

  const businessMatch = trimmed.match(/^Business phase (\d+) · (.+)$/)
  if (businessMatch) {
    return value.replace(trimmed, `Fase de negocio ${businessMatch[1]} · ${businessMatch[2].replaceAll(' chars', ' caracteres').replaceAll('prompt', 'prompt').replaceAll('synced', 'sincronizado')}`)
  }

  const workingMatch = trimmed.match(/^(P\d{2}) Claude Code is working$/)
  if (workingMatch) return value.replace(trimmed, `${workingMatch[1]} Claude Code esta trabajando`)

  const startingMatch = trimmed.match(/^(P\d{2}) Claude Code build starting$/)
  if (startingMatch) return value.replace(trimmed, `Compilacion de ${startingMatch[1]} con Claude Code iniciando`)

  const word = wordTranslations[trimmed]
  if (word) return value.replace(trimmed, word)

  let translated = trimmed
  for (const [pattern, replacement] of phraseTranslations) {
    translated = translated.replace(pattern, replacement)
  }
  if (translated === trimmed) translated = translateWords(trimmed)
  return translated !== trimmed ? value.replace(trimmed, translated) : value
}

function shouldSkip(node: Node) {
  const parent = node.parentElement
  if (!parent) return true
  return Boolean(parent.closest('script, style, code, pre, textarea, input, select, option, svg, [data-no-translate]'))
}

function translate(root: HTMLElement, language: 'en' | 'es') {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)

  for (const node of nodes) {
    if (shouldSkip(node)) continue
    const current = node.nodeValue ?? ''
    let original = originals.get(node)
    if (!original) {
      original = current
      originals.set(node, original)
    } else if (current !== original && current !== translateText(original)) {
      original = current
      originals.set(node, original)
    }
    const next = language === 'es' ? translateText(original) : original
    // Only write when the value actually changes. An unconditional assignment
    // queues a characterData mutation even for identical text, which would
    // re-trigger the MutationObserver below and spin the main thread forever.
    if (node.nodeValue !== next) node.nodeValue = next
  }

  const attributes = ['title', 'aria-label', 'placeholder']
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('a, button, input, textarea, [title], [aria-label], [placeholder]'))) {
    if (element.closest('script, style, code, pre, [data-no-translate]')) continue
    for (const attribute of attributes) {
      const current = element.getAttribute(attribute)
      if (!current) continue
      const key = `data-original-${attribute}`
      const original = element.getAttribute(key) ?? current
      if (!element.hasAttribute(key)) element.setAttribute(key, original)
      const next = language === 'es' ? translateText(original) : original
      if (current !== next) element.setAttribute(attribute, next)
    }
  }
}

// Gather visible UI strings the static dictionary hasn't fully covered (anything
// without an exact or already-fetched translation) so the API can translate them.
function collectUntranslated(root: HTMLElement): string[] {
  const out = new Set<string>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (shouldSkip(node)) continue
    const trimmed = (node.nodeValue ?? '').trim()
    if (!trimmed || !looksTranslatable(trimmed)) continue
    if (exactTranslations[trimmed] || apiTranslations.has(trimmed) || requested.has(trimmed)) continue
    out.add(trimmed)
  }
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[title], [aria-label], [placeholder]'))) {
    if (element.closest('script, style, code, pre, [data-no-translate]')) continue
    for (const attribute of ['title', 'aria-label', 'placeholder']) {
      const value = (element.getAttribute(`data-original-${attribute}`) ?? element.getAttribute(attribute) ?? '').trim()
      if (!value || !looksTranslatable(value)) continue
      if (exactTranslations[value] || apiTranslations.has(value) || requested.has(value)) continue
      out.add(value)
    }
  }
  return [...out]
}

export function SpanishTranslator({ children, language }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    let observer: MutationObserver | null = null
    let cancelled = false
    const observeConfig: MutationObserverInit = {
      attributes: true,
      attributeFilter: ['title', 'aria-label', 'placeholder'],
      characterData: true,
      childList: true,
      subtree: true
    }
    // Disconnect while translating so our own DOM writes don't feed back into
    // the observer (a MutationObserver callback is async, so an in-callback
    // re-entrancy flag cannot prevent that self-trigger). Re-observe afterward
    // to keep picking up real content changes from React re-renders.
    const retranslate = () => {
      if (cancelled || !observer) return
      observer.disconnect()
      translate(root, language)
      if (!cancelled) observer.observe(root, observeConfig)
    }
    // Fetch full LLM translations for anything the dictionary missed, then re-apply.
    // The `requested` guard + the write-only-on-change guard in translate() make
    // this converge (no fetch/observe loop).
    const backfill = async () => {
      if (cancelled || language !== 'es') return
      const missing = collectUntranslated(root)
      if (missing.length === 0) return
      missing.forEach((value) => requested.add(value))
      try {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ strings: missing })
        })
        if (!response.ok || cancelled) return
        const map = await response.json() as Record<string, string>
        let added = false
        for (const [english, spanish] of Object.entries(map)) {
          if (spanish && spanish !== english && !apiTranslations.has(english)) {
            apiTranslations.set(english, spanish)
            added = true
          }
        }
        if (added && !cancelled) retranslate()
      } catch {
        // Offline or no LLM key configured — keep the dictionary result.
      }
    }
    const apply = () => {
      retranslate()
      void backfill()
    }
    const timer = window.setTimeout(() => {
      if (cancelled) return
      observer = new MutationObserver(apply)
      translate(root, language)
      observer.observe(root, observeConfig)
      void backfill()
    }, 750)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      observer?.disconnect()
    }
  }, [language])

  return <div ref={ref} className="contents" suppressHydrationWarning>{children}</div>
}
