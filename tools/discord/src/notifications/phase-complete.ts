import { sendNotification } from '../bot.js'

export async function notifyPhaseComplete(phase: string, phaseName: string) {
  await sendNotification(`Phase ${phase} complete - ${phaseName}`, 'development')
}
