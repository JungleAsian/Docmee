'use client'

import { useRef } from 'react'
import { Icon } from '../icon'

// Browses saved reference mockups (tools/mockup-library/) with view links.
export function MockupLibrary({ files, report }: { files: string[]; report?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const close = () => ref.current?.close()

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="inline-flex items-center gap-1 rounded-md border border-amber-700 bg-amber-950/20 px-2.5 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-950/50"
        aria-haspopup="dialog"
      >
        <Icon name="library" className="h-3.5 w-3.5" />Library ({files.length})
      </button>
      <dialog
        ref={ref}
        className="m-auto w-[min(42rem,94vw)] rounded-lg border border-slate-700 bg-slate-900 p-0 text-slate-200 backdrop:bg-black/60"
        onClick={(event) => { if (event.target === ref.current) close() }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">Saved mockup references ({files.length})</h3>
          <button type="button" onClick={close} aria-label="Close" className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">✕</button>
        </div>
        <div className="max-h-[70vh] overflow-auto px-4 py-3">
          {report && (
            <a
              href={`/api/mockup-library/${encodeURIComponent(report)}`}
              target="_blank"
              rel="noreferrer"
              className="mb-3 flex items-center justify-between gap-3 rounded-md border border-sky-700 bg-sky-950/30 px-3 py-2 text-sm font-medium text-sky-100 hover:bg-sky-950/60"
            >
              <span>📄 UI Design Report (all screens, PDF)</span>
              <span className="shrink-0 text-xs text-sky-300">Open ↗</span>
            </a>
          )}
          {files.length === 0 ? (
            <p className="text-sm text-slate-400">No saved mockups yet. Generate a mockup on a screen, then click <span className="font-medium text-amber-200">Save</span> to keep it here as a reference.</p>
          ) : (
            <ul className="space-y-1.5">
              {files.map((file) => (
                <li key={file} className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <span className="min-w-0 break-all font-mono text-xs text-slate-300">{file}</span>
                  <a
                    href={`/api/mockup-library/${encodeURIComponent(file)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-md bg-cyan-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
                  >
                    View ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">Saved to <span className="font-mono">tools/mockup-library/</span> — kept across regenerations for future deployment reference.</p>
        </div>
      </dialog>
    </>
  )
}
