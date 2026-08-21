'use client'

// Screen 4 (Quick replies & templates) — the list/add/edit UI lives in the shared
// QuickRepliesManager so it can also render as a section on the merged WhatsApp
// Templates page (item 9). This route stays as a thin standalone wrapper.
import { StudioMessagingTabs } from '@/shared/components/StudioMessagingTabs'
import { QuickRepliesManager } from '@/shared/components/QuickRepliesManager'

export default function QuickRepliesPage() {
  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <StudioMessagingTabs />
      <QuickRepliesManager />
    </div>
  )
}
