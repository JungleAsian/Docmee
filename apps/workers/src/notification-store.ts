// Adapts the @docmee/db notifications repository to the dispatcher's injected
// NotificationStore port. Shared by the notification worker and timeout monitor.
import type { NotificationStore } from '@docmee/notifications'
import type { NotificationsRepository } from '@docmee/db'

export function buildNotificationStore(notifications: NotificationsRepository): NotificationStore {
  return {
    claim: async (input) => {
      const data = {
        clinicId: input.clinicId,
        conversationId: input.conversationId ?? null,
        alertType: input.alertType,
        priority: input.priority,
        notificationType: input.notificationType,
        recipient: input.recipient,
        subject: input.subject,
        content: input.content,
        status: input.status,
      }
      if (input.idempotencyKey) {
        const result = await notifications.claimOnce({
          ...data,
          idempotencyKey: input.idempotencyKey,
          claimOwner: input.claimOwner ?? null,
        })
        return { id: result.event.id, claimed: result.claimed }
      }
      const row = await notifications.create(data)
      return { id: row.id, claimed: true }
    },
    updateStatus: (id, status, error) => notifications.updateStatus(id, status, error),
  }
}
