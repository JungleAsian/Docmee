'use client'

import { useRef } from 'react'
import { Icon } from '../icon'

// Automated mockup-first flow (Option A, HTML preview):
//  1. Generate mockup  -> Claude Code writes tools/logs/mockups/screen-N.html
//  2. Preview mockup   -> render that HTML in a sandboxed iframe for approval
//  3. Approve & Build  -> the approved mockup + prompt go to Claude Code to build
//  4. (row) Approve    -> marks the built screen complete
export function MockupFlow({
  screenId,
  screenLabel,
  screenName,
  hasMockup,
  mockupPrompt,
  buildPrompt
}: {
  screenId: number
  screenLabel: string
  screenName: string
  hasMockup: boolean
  mockupPrompt: string
  buildPrompt: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const close = () => ref.current?.close()

  if (!hasMockup) {
    return (
      <form action="/api/actions" method="post" className="inline">
        <input type="hidden" name="action" value="claude-design-run" />
        <input type="hidden" name="prompt" value={mockupPrompt} />
        <input type="hidden" name="uiScreenId" value={screenId} />
        <input type="hidden" name="uiScreen" value={screenName} />
        <button className="inline-flex items-center justify-center rounded-md border border-cyan-700 bg-cyan-950/30 p-1 text-cyan-100 hover:bg-cyan-950/60" title="Generate an HTML mockup with Claude Code for your approval" aria-label="Generate mockup">
          <Icon name="plus" className="h-3.5 w-3.5" />
        </button>
      </form>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="inline-flex items-center justify-center rounded-md border border-cyan-700 bg-cyan-950/30 p-1 text-cyan-100 hover:bg-cyan-950/60"
        aria-haspopup="dialog"
        title="Preview the generated mockup"
        aria-label="Preview mockup"
      >
        <Icon name="eye" className="h-3.5 w-3.5" />
      </button>
      <form action="/api/actions" method="post" className="inline">
        <input type="hidden" name="action" value="mockup-build" />
        <input type="hidden" name="id" value={screenId} />
        <input type="hidden" name="prompt" value={buildPrompt} />
        <button className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-500 px-2 py-0.5 text-[11px] leading-5 font-semibold text-slate-950 hover:bg-emerald-400" title="Approve this mockup and build the real screen in Docmee">
          <Icon name="build" className="h-3.5 w-3.5" />Build
        </button>
      </form>
      <form action="/api/actions" method="post" className="inline">
        <input type="hidden" name="action" value="mockup-save" />
        <input type="hidden" name="id" value={screenId} />
        <button className="inline-flex items-center justify-center rounded-md border border-amber-600 bg-amber-950/20 p-1 text-amber-200 hover:bg-amber-950/50" title="Save this mockup to the reference library (mockup-library/Screen_Phase_Features.html) for later" aria-label="Save mockup to library">
          <Icon name="library" className="h-3.5 w-3.5" />
        </button>
      </form>
      <form action="/api/actions" method="post" className="inline">
        <input type="hidden" name="action" value="claude-design-run" />
        <input type="hidden" name="prompt" value={mockupPrompt} />
        <input type="hidden" name="uiScreenId" value={screenId} />
        <input type="hidden" name="uiScreen" value={screenName} />
        <button className="inline-flex items-center justify-center rounded-md border border-slate-600 p-1 text-slate-300 hover:bg-slate-800" title="Discard and regenerate the mockup" aria-label="Regenerate mockup">
          <Icon name="refresh" className="h-3.5 w-3.5" />
        </button>
      </form>
      <dialog
        ref={ref}
        className="m-auto h-[88vh] w-[min(80rem,96vw)] rounded-lg border border-slate-700 bg-slate-900 p-0 text-slate-200 backdrop:bg-black/70"
        onClick={(event) => { if (event.target === ref.current) close() }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">Mockup preview — {screenLabel}</h3>
          <div className="flex items-center gap-2">
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="mockup-save" />
              <input type="hidden" name="id" value={screenId} />
              <button className="rounded-md border border-amber-600 bg-amber-950/20 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-950/50" title="Save to the reference library for later">Save</button>
            </form>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="mockup-build" />
              <input type="hidden" name="id" value={screenId} />
              <input type="hidden" name="prompt" value={buildPrompt} />
              <button className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400">Approve &amp; Build →</button>
            </form>
            <button type="button" onClick={close} aria-label="Close" className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">✕</button>
          </div>
        </div>
        <iframe
          src={`/api/mockup/${screenId}`}
          sandbox="allow-same-origin"
          title={`Mockup for ${screenLabel}`}
          className="h-[calc(88vh-49px)] w-full rounded-b-lg bg-white"
        />
      </dialog>
    </>
  )
}
