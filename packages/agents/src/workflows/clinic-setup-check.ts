import type { WorkflowEdge, WorkflowNode } from '@docmee/db'
import { checkWorkflow, type WorkflowLintContext } from './workflow-lint.js'

/**
 * Clinic setup check: configuration mistakes that stop (or quietly change) what
 * patients get, looking at clinic settings and the LIVE workflows together.
 * The workflow editor's lint covers one workflow at a time; this catches the
 * problems that only show up across settings + workflows, e.g. business hours
 * that silence every workflow. Mirrors the runtime in
 * apps/workers/src/agent-processor.worker.ts and workflow-runner.worker.ts.
 */

export type SetupIssueCode =
  | 'no_active_channel'
  | 'workflows_never_run'
  | 'workflows_after_hours_only'
  | 'published_workflow_broken'
  | 'published_workflow_warnings'
  | 'overlapping_triggers'

export interface SetupIssue {
  /** Stable identity (code + subject) so the same problem is only notified once. */
  key: string
  code: SetupIssueCode
  severity: 'error' | 'warning'
  title: string
  whatHappened: string
  howToFix: string
  translations: { es: { title: string; whatHappened: string; howToFix: string } }
  /** Where in the panel to fix it. */
  href: string
  workflowId?: string
}

export interface LiveWorkflow {
  id: string
  name: string
  /** The graph that actually runs (the active revision when there is one). */
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface ClinicSetupFacts {
  clinicId: string
  /** settings.businessHours; null/empty means "not set". */
  businessHours: Record<string, unknown> | null
  automationDuringBusinessHours: boolean
  /** Status of every connected messaging account (WhatsApp, Messenger, Instagram). */
  channelStatuses: string[]
  liveWorkflows: LiveWorkflow[]
  lint: WorkflowLintContext
}

function keywordsOf(workflow: LiveWorkflow): string[] | null {
  const trigger = workflow.nodes.find((node) => node.type === 'trigger.message_keyword')
  if (!trigger) return null
  return String(trigger.config?.['keywords'] ?? '')
    .split(',')
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean)
}

/** True when some message could start both workflows (mirrors workflowKeywordMatches). */
function triggersOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true
  return a.some((x) => b.some((y) => x.includes(y) || y.includes(x)))
}

export function checkClinicSetup(facts: ClinicSetupFacts): SetupIssue[] {
  const issues: SetupIssue[] = []
  const workflowsHref = '/studio/workflows'
  const clinicHref = `/studio/clinics/${facts.clinicId}`
  const keywordWorkflows = facts.liveWorkflows.filter((workflow) => keywordsOf(workflow) !== null)

  if (facts.liveWorkflows.length > 0 && !facts.channelStatuses.includes('active')) {
    issues.push({
      key: 'no_active_channel',
      code: 'no_active_channel',
      severity: 'error',
      title: 'No messaging channel is connected',
      whatHappened: 'Workflows are published, but there is no active WhatsApp, Messenger or Instagram account, so patients cannot reach them and no replies can be sent.',
      howToFix: 'Connect or reactivate a channel in Studio → Channels.',
      translations: { es: {
        title: 'No hay ningún canal de mensajes conectado',
        whatHappened: 'Hay flujos publicados, pero no hay una cuenta activa de WhatsApp, Messenger o Instagram, así que los pacientes no pueden llegar a ellos y no se pueden enviar respuestas.',
        howToFix: 'Conecta o reactiva un canal en Studio → Canales.',
      } },
      href: '/studio/channels',
    })
  }

  if (keywordWorkflows.length > 0 && !facts.automationDuringBusinessHours) {
    const hoursSet = Boolean(facts.businessHours && Object.keys(facts.businessHours).length > 0)
    if (!hoursSet) {
      issues.push({
        key: 'workflows_never_run',
        code: 'workflows_never_run',
        severity: 'error',
        title: 'Workflows will never answer patients',
        whatHappened: 'Workflows only answer while the clinic is closed, and with no business hours set the clinic counts as always open — so no published workflow ever starts.',
        howToFix: 'Set the clinic’s business hours, or turn on “Also answer automatically during business hours” in the clinic’s Bot settings.',
        translations: { es: {
          title: 'Los flujos nunca responderán a los pacientes',
          whatHappened: 'Los flujos solo responden cuando la clínica está cerrada, y sin horario de atención la clínica cuenta como siempre abierta, así que ningún flujo publicado inicia.',
          howToFix: 'Configura el horario de atención de la clínica, o activa “Responder automáticamente también en horario de atención” en la configuración del Bot.',
        } },
        href: clinicHref,
      })
    } else {
      issues.push({
        key: 'workflows_after_hours_only',
        code: 'workflows_after_hours_only',
        severity: 'warning',
        title: 'Workflows only answer while the clinic is closed',
        whatHappened: 'During business hours, patient messages are left for staff and published workflows do not start. If nobody is answering the inbox, patients get no reply.',
        howToFix: 'If the workflows should answer at any time, turn on “Also answer automatically during business hours” in the clinic’s Bot settings.',
        translations: { es: {
          title: 'Los flujos solo responden con la clínica cerrada',
          whatHappened: 'En horario de atención, los mensajes quedan para el personal y los flujos publicados no inician. Si nadie atiende la bandeja, el paciente no recibe respuesta.',
          howToFix: 'Si los flujos deben responder a cualquier hora, activa “Responder automáticamente también en horario de atención” en la configuración del Bot.',
        } },
        href: clinicHref,
      })
    }
  }

  for (const workflow of facts.liveWorkflows) {
    const result = checkWorkflow(workflow.nodes, workflow.edges, facts.lint)
    if (result.errors.length > 0) {
      const first = result.errors[0]!
      issues.push({
        key: `published_workflow_broken:${workflow.id}`,
        code: 'published_workflow_broken',
        severity: 'error',
        title: `Published workflow “${workflow.name}” cannot run`,
        whatHappened: `It has ${result.errors.length} blocking problem(s), so the system refuses to run it. First: ${first.title}${first.where ? ` (${first.where})` : ''}.`,
        howToFix: 'Open the workflow, fix the problems listed in its Problems panel, and publish it again.',
        translations: { es: {
          title: `El flujo publicado “${workflow.name}” no puede ejecutarse`,
          whatHappened: `Tiene ${result.errors.length} problema(s) que lo bloquean, así que el sistema se niega a ejecutarlo. Primero: ${first.translations?.es?.title ?? first.title}${first.where ? ` (${first.where})` : ''}.`,
          howToFix: 'Abre el flujo, corrige los problemas del panel de Problemas y vuelve a publicarlo.',
        } },
        href: workflowsHref,
        workflowId: workflow.id,
      })
    } else if (result.warnings.length > 0) {
      const titles = result.warnings.slice(0, 2).map((warning) => warning.title)
      const titlesEs = result.warnings.slice(0, 2).map((warning) => warning.translations?.es?.title ?? warning.title)
      issues.push({
        key: `published_workflow_warnings:${workflow.id}:${result.warnings.map((warning) => `${warning.code}@${warning.nodeId ?? ''}`).sort().join(',')}`,
        code: 'published_workflow_warnings',
        severity: 'warning',
        title: `Published workflow “${workflow.name}” may not work as expected`,
        whatHappened: `${result.warnings.length} warning(s): ${titles.join('; ')}${result.warnings.length > 2 ? '; …' : ''}.`,
        howToFix: 'Open the workflow and review its Problems panel.',
        translations: { es: {
          title: `El flujo publicado “${workflow.name}” podría no funcionar como esperas`,
          whatHappened: `${result.warnings.length} advertencia(s): ${titlesEs.join('; ')}${result.warnings.length > 2 ? '; …' : ''}.`,
          howToFix: 'Abre el flujo y revisa su panel de Problemas.',
        } },
        href: workflowsHref,
        workflowId: workflow.id,
      })
    }
  }

  for (let i = 0; i < keywordWorkflows.length; i++) {
    for (let j = i + 1; j < keywordWorkflows.length; j++) {
      const a = keywordWorkflows[i]!
      const b = keywordWorkflows[j]!
      if (!triggersOverlap(keywordsOf(a)!, keywordsOf(b)!)) continue
      const pair = [a.id, b.id].sort().join('+')
      issues.push({
        key: `overlapping_triggers:${pair}`,
        code: 'overlapping_triggers',
        severity: 'warning',
        title: `“${a.name}” and “${b.name}” start on the same messages`,
        whatHappened: 'Both published workflows can be started by the same patient message, so the patient may get two different replies at once.',
        howToFix: 'Give each workflow its own keywords, or unpublish one of them.',
        translations: { es: {
          title: `“${a.name}” y “${b.name}” inician con los mismos mensajes`,
          whatHappened: 'Ambos flujos publicados pueden iniciarse con el mismo mensaje del paciente, así que el paciente podría recibir dos respuestas distintas a la vez.',
          howToFix: 'Dale a cada flujo sus propias palabras clave, o despublica uno de ellos.',
        } },
        href: workflowsHref,
      })
    }
  }

  // Errors first, then warnings, keeping rule order within each group.
  return [...issues.filter((issue) => issue.severity === 'error'), ...issues.filter((issue) => issue.severity === 'warning')]
}
