'use client'

// The Docmee wordmark at the left end of the top bar. Rendered by BOTH app layouts
// (clinic pages and Studio) as the first header item, so every page shows the logo
// in the same place. It links home; the link carries the accessible name, so the
// image itself is decorative.
import Link from 'next/link'
import { useI18n } from '../hooks/useI18n'

export function TopbarLogo({ href = '/inbox' }: { href?: string }) {
  const { t } = useI18n()
  return (
    <Link href={href} className="crm-topbar-logo" aria-label={t('app.name')} title={t('app.name')}>
      <img src="/brand/docmee-logo.png?v=20260821" alt="" />
    </Link>
  )
}
