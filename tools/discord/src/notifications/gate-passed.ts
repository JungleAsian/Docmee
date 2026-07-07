import { sendNotification } from '../bot.js'

export async function notifyGatePassed(gate: number, phaseName: string) {
  await sendNotification(`Gate ${gate} passed - ${phaseName}`, 'development')
}
