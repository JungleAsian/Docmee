import { sendNotification } from '../bot.js'

export async function notifyGateFailed(gate: number, phaseName: string, error: string) {
  await sendNotification(`Gate ${gate} FAILED - ${phaseName}\n\`\`\`\n${error}\n\`\`\``, 'critical')
}
