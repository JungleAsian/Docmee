'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'

// Shared page-header back-navigation control. Two modes:
//  - href: real navigation via router.back() when there's history to go back
//    to, falling back to a direct <Link> to `href` when the page was reached
//    directly (no history) — e.g. a bookmarked URL or a fresh tab.
//  - onClick: for the one non-navigating case (the workflow editor's in-page
//    panel-close button, which toggles state rather than changing routes —
//    router.back() would be wrong there since no navigation ever happened).
const DEFAULT_CLASS = 'text-xs font-medium text-cyan-700 hover:underline dark:text-cyan-300'

export function BackButton({
  href,
  onClick,
  label,
  className,
}: {
  href?: string
  onClick?: () => void
  label: string
  className?: string
}) {
  const router = useRouter()
  const cls = className ?? DEFAULT_CLASS

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        ← {label}
      </button>
    )
  }

  if (href) {
    return (
      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined' && window.history.length > 1) router.back()
          else router.push(href)
        }}
        className={cls}
      >
        ← {label}
      </button>
    )
  }

  return null
}

// A plain-link variant for call sites that want to keep a real <Link> (e.g.
// for prefetching or right-click "open in new tab") rather than router.back().
export function BackLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <Link href={href} className={className ?? DEFAULT_CLASS}>
      ← {label}
    </Link>
  )
}
