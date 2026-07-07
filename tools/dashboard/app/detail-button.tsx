'use client'

import { useRef } from 'react'
import { Icon, type IconName } from './icon'

// A compact button that opens long text in a centered modal pop-up, so text-heavy
// cells/cards don't bloat a row or column. Uses the native <dialog> so backdrop,
// Esc-to-close, and focus handling come for free. Shared across pages.
// Pass `icon` to swap the 📋 glyph for a Lineicon; an empty buttonLabel makes it
// icon-only (with the title as the accessible name).
export function DetailButton({
  buttonLabel = 'View',
  title,
  body,
  className = '',
  icon,
}: {
  buttonLabel?: string
  title: string
  body: string
  className?: string
  icon?: IconName
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const close = () => ref.current?.close()
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-xs text-cyan-200 hover:border-cyan-600 hover:bg-cyan-950/40 ${className}`}
        aria-haspopup="dialog"
        aria-label={buttonLabel || title}
        title={buttonLabel ? undefined : title}
      >
        {icon ? <Icon name={icon} className="h-3.5 w-3.5" /> : <span aria-hidden="true">📋</span>}
        {buttonLabel ? <span>{buttonLabel}</span> : null}
      </button>
      <dialog
        ref={ref}
        className="m-auto w-[min(42rem,92vw)] rounded-lg border border-slate-700 bg-slate-900 p-0 text-slate-200 backdrop:bg-black/60"
        onClick={(event) => { if (event.target === ref.current) close() }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <button type="button" onClick={close} aria-label="Close" className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">✕</button>
        </div>
        <div className="max-h-[60vh] overflow-auto px-4 py-3">
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{body}</p>
        </div>
      </dialog>
    </>
  )
}
