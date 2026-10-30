import { layaLanguageOf, layaReadbackText, readbackConfirmed } from '../laya/observations.js'
import { MENU_HOLD_OUTCOME, MENU_RESEND_OUTCOME, resolveMenuHandle, type WorkflowMenuOption } from './workflow-engine.js'

/**
 * LAYA on static interactive menus: one decision used by the live WhatsApp worker AND the
 * Automation Center simulator, so a simulation exercises exactly what patients get.
 *
 * - A tap or an exact option match always wins; LAYA is only asked about unmatched typed text.
 * - A normal LAYA pick routes and echoes what was understood ("Reply 0 for the main menu").
 * - A pick that would create, move or cancel a booking holds for a YES/NO read-back check.
 * - At the check: 0 / 1 / a tap win; only a clear YES continues; anything else shows the menu again.
 */

/** Context key for a LAYA pick waiting on the YES/NO read-back check. */
export const LAYA_READBACK_CONTEXT_KEY = 'layaReadback'

export interface LayaReadback { nodeId: string; optionId: string; title: string }

/** Returns the option LAYA is allowed to route to, or null (not live, unsure, unavailable). */
export type LayaMenuChooser = (text: string, options: WorkflowMenuOption[]) => Promise<string | null>

export interface LayaMenuDecision {
  /** Option id, 'default', 'restart', 'livechat', MENU_HOLD_OUTCOME or MENU_RESEND_OUTCOME. */
  handle: string
  /** Read-back text to send before routing or holding. */
  message?: string
  /** Set with MENU_HOLD_OUTCOME: store under LAYA_READBACK_CONTEXT_KEY and keep the menu paused. */
  pending?: LayaReadback
  /** The person tapped or typed an exact option: ground truth for earlier typed text on this menu. */
  pickedOptionId?: string
  /** The person confirmed LAYA's pick with a clear YES: ground truth as well. */
  confirmedOptionId?: string
  /** What LAYA picked, for display and diagnostics. */
  laya?: { optionId: string; title: string; check: 'routed' | 'confirm' }
}

export function readPendingReadback(value: unknown): LayaReadback | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { nodeId, optionId, title } = value as Record<string, unknown>
  return typeof nodeId === 'string' && typeof optionId === 'string' && typeof title === 'string'
    ? { nodeId, optionId, title } : undefined
}

export async function decideLayaMenuReply(input: {
  nodeId: string
  options: WorkflowMenuOption[]
  replyId?: string
  text: string
  /** The pending read-back, already removed from the context by the caller. */
  pending?: LayaReadback
  /** Options on this menu that lead straight to a booking create/reschedule/cancel step. */
  committing?: ReadonlySet<string>
  choose: LayaMenuChooser
}): Promise<LayaMenuDecision> {
  const { nodeId, options, replyId, text, pending } = input
  if (pending && pending.nodeId === nodeId) {
    const trimmed = text.trim()
    if (trimmed === '0') return { handle: 'restart' }
    if (trimmed === '1') return { handle: 'livechat' }
    if (replyId && options.some(option => option.optionId === replyId)) return { handle: replyId, pickedOptionId: replyId }
    return readbackConfirmed(text)
      ? { handle: pending.optionId, confirmedOptionId: pending.optionId }
      : { handle: MENU_RESEND_OUTCOME }
  }
  const handle = resolveMenuHandle(options, replyId, text)
  if (handle === 'restart' || handle === 'livechat') return { handle }
  if (handle !== 'default') return { handle, pickedOptionId: handle }
  let chosen: string | null = null
  try { chosen = await input.choose(text, options) } catch { chosen = null }
  const option = chosen ? options.find(candidate => candidate.optionId === chosen) : undefined
  if (!option) return { handle }
  const language = layaLanguageOf(text)
  if (input.committing?.has(option.optionId)) {
    return {
      handle: MENU_HOLD_OUTCOME,
      message: layaReadbackText('confirm', language, option.title, text),
      pending: { nodeId, optionId: option.optionId, title: option.title },
      laya: { optionId: option.optionId, title: option.title, check: 'confirm' },
    }
  }
  return {
    handle: option.optionId,
    message: layaReadbackText('routed', language, option.title),
    laya: { optionId: option.optionId, title: option.title, check: 'routed' },
  }
}

/**
 * The message that started a fresh run may already clearly pick an option on the first static
 * menu ("quiero una cita" -> Book). A booking-committing pick is not preselected: the menu is shown.
 */
export async function decideLayaPreselect(input: {
  options: WorkflowMenuOption[]
  text: string
  committing?: ReadonlySet<string>
  choose: LayaMenuChooser
}): Promise<{ optionId: string; message: string; title: string } | null> {
  let chosen: string | null = null
  try { chosen = await input.choose(input.text, input.options) } catch { chosen = null }
  const option = chosen ? input.options.find(candidate => candidate.optionId === chosen) : undefined
  if (!option || input.committing?.has(option.optionId)) return null
  return { optionId: option.optionId, title: option.title, message: layaReadbackText('routed', layaLanguageOf(input.text), option.title) }
}
