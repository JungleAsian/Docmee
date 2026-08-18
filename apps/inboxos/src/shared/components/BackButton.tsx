'use client'

// In-page "close/cancel this panel" control -- NOT page navigation. Used
// exclusively by the workflow editor's own back-to-list button, which closes
// an in-page editor panel (a client-state toggle within the same route),
// not a route change. Real cross-page back-navigation lives in a single
// global control instead: PlatformBackButton.tsx, rendered once in the admin
// header next to the sidebar-rail toggle and Breadcrumbs.
export function BackButton({
  onClick,
  label,
  className,
}: {
  onClick: () => void
  label: string
  className?: string
}) {
  const cls = className ?? 'text-xs font-medium text-cyan-700 hover:underline dark:text-cyan-300'
  return (
    <button type="button" onClick={onClick} className={cls}>
      ← {label}
    </button>
  )
}
