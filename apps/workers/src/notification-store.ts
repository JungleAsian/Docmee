// Adapts the @docmee/db notifications repository to the dispatcher's injected
// NotificationStore port. Shared by the notification worker and timeout monitor.
import type { NotificationStore } from '@docmee/notifications'
import type { NotificationsRepository } from '@docmee/db'

export function buildNotificationStore(notifications: NotificationsRepository): NotificationStore {
  return {
    create: async (input) => {
      const row = await notifications.create({
        clinicId: input.clinicId,
        conversationId: input.conversationId ?? null,
        alertType: input.alertType,
        priority: input.priority,
        notificationType: input.notificationType,
        recipient: input.recipient,
        subject: input.subject,
        content: input.content,
        status: input.status,
      })
      return { id: row.id }
    },
    updateStatus: (id, status, error) => notifications.updateStatus(id, status, error),
  }
}
