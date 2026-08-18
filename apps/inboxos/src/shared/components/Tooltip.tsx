'use client'

// Minimal hover-triggered tooltip. No dedicated tooltip component existed in the
// repo before this (items 14 and 21 of the 25-item batch both need one) — every
// existing "hint" in the app uses the native title= attribute instead, which
// doesn't support multi-line copy or styling. This wraps a trigger element and
// shows a small floating panel above it on hover/focus.
import { useState, type ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
  className?: string
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const [open, setOpen] = useState(false)

  return (
    <span
      className={`relative inline-flex ${className ?? ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-max max-w-56 -translate-x-1/2 rounded-md bg-gray-900 px-2 py-1.5 text-[11px] leading-snug text-white shadow-lg dark:bg-gray-700"
        >
          {content}
        </span>
      )}
    </span>
  )
}
