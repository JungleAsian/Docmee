'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition, type MouseEvent, type ReactNode } from 'react'

type LaneLinkProps = {
  href: string
  className?: string
  ariaLabel?: string
  children: ReactNode
}

// Wraps a navigation card so clicking it shows an immediate spinner overlay
// while the next route loads, instead of the page appearing to freeze in the
// beat between the click and the destination rendering.
export function LaneLink({ href, className, ariaLabel, children }: LaneLinkProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle new-tab / modifier / non-primary clicks normally.
    if (event.defaultPrevented) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    startTransition(() => router.push(href))
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-busy={pending}
      className={`relative ${pending ? 'cursor-wait' : ''} ${className ?? ''}`}
    >
      {children}
      {pending && (
        <span className="absolute inset-0 z-10 grid place-items-center rounded-md bg-slate-950/55 backdrop-blur-[1px]">
          <span className="devtools-loading-spinner" aria-hidden="true" />
          <span className="sr-only">Loading</span>
        </span>
      )}
    </Link>
  )
}
