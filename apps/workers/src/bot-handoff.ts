// Shared handoff-pause primitive. Extracted out of agent-processor.worker.ts
// so workflow-runner.worker.ts's action.ai_agent node can pause the bot the
// SAME real way the main conversational pipeline does, rather than a
// cosmetic notification (action.notify_secretary does not touch conversation
// status and does not stop the bot from replying on the next turn).
import { BOT_PAUSED_AT, HANDOFF_REASON } from '@docmee/agents'
import { createConversationsRepository, type Sql } from '@docmee/db'

/**
 * Pause the bot for a human handoff (Rev1 #5/#6): flip the conversation to
 * `handoff` and stamp who/why so the inbox shows the bot is off and the
 * timeout monitor can later reactivate it. No-op when there is no
 * conversation to pause.
 */
export async function pauseBotForHandoff(
  sql: Sql,
  clinicId: string,
  conversationId: string | undefined,
  currentMetadata: Record<string, unknown> | undefined,
  reason: string,
): Promise<void> {
  if (!conversationId) return
  await createConversationsRepository(sql).update(clinicId, conversationId, {
    status: 'handoff',
    metadata: {
      ...(currentMetadata ?? {}),
      [BOT_PAUSED_AT]: new Date().toISOString(),
      [HANDOFF_REASON]: reason,
    },
  })
}
