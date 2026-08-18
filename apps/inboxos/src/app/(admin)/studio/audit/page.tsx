import { redirect } from 'next/navigation'

// Item 17 of the 25-item batch: Audit was renamed/relocated to Activities.
// Kept as a redirect so existing links/bookmarks to /studio/audit keep working.
export default function AuditPage() {
  redirect('/studio/activities')
}
