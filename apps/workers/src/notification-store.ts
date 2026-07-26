// Adapts the @docmee/db notifications repository to the dispatcher's injected
// NotificationStore port. Shared by the notification worker and timeout monitor.
import type { NotificationStore } from '@docmee/notifications'
import type { NotificationsRepository } from '@docmee/db'

export function buildNotificationStore(notifications: NotificationsRepository): NotificationStore {
  return {
    create: async (input) => {
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
        const result = await notifications.createOnce({
          ...data,
          idempotencyKey: input.idempotencyKey,
        })
        return { id: result.event.id, created: result.created }
      }
      const row = await notifications.create(data)
      return { id: row.id, created: true }
    },
    updateStatus: (id, status, error) => notifications.updateStatus(id, status, error),
  }
}
