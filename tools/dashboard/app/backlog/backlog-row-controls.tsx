'use client'

import { Icon } from '../icon'

const STATUSES = ['todo', 'in-progress', 'blocked', 'review', 'done'] as const

// Per-row backlog controls: a status dropdown (auto-submits on change) and a
// delete button — replaces the old single "Mark Done".
export function BacklogRowControls({ id, status }: { id: number; status: string }) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <form action="/api/actions" method="post" className="inline">
        <input type="hidden" name="action" value="backlog-status" />
        <input type="hidden" name="id" value={id} />
        <select
          name="status"
          defaultValue={STATUSES.includes(status as (typeof STATUSES)[number]) ? status : 'todo'}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          aria-label={`Status for task ${id}`}
          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
        >
          {STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </form>
      <form action="/api/actions" method="post" className="inline">
        <input type="hidden" name="action" value="backlog-delete" />
        <input type="hidden" name="id" value={id} />
        <button className="inline-flex items-center justify-center rounded border border-red-800 p-1 text-red-300 hover:bg-red-950/40" title={`Delete task ${id}`} aria-label={`Delete task ${id}`}><Icon name="trash" className="h-3.5 w-3.5" /></button>
      </form>
    </div>
  )
}
