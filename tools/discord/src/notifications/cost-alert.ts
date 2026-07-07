import { sendNotification } from '../bot.js'

export async function notifyCostAlert(spend: number, threshold: number, usdToCad = 1.36) {
  const spendCad = spend * usdToCad
  const thresholdCad = threshold * usdToCad
  await sendNotification(
    `Cost alert - Daily spend USD $${spend.toFixed(2)} (CAD $${spendCad.toFixed(2)}) exceeded threshold USD $${threshold.toFixed(2)} (CAD $${thresholdCad.toFixed(2)})`,
    'critical'
  )
}
