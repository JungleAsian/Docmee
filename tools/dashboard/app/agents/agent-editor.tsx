'use client'

import { useState } from 'react'

type Service = { id: string; label: string; models: string[] }

// Inline editor on each agent card: switch the agent to a different AI service +
// model. The model list follows the selected service. Submits to agents-set-service.
export function AgentEditor({ role, service, model, services }: { role: string; service: string; model: string; services: Service[] }) {
  const [svc, setSvc] = useState(service)
  const [mdl, setMdl] = useState(model)
  const models = services.find((item) => item.id === svc)?.models ?? []

  return (
    <form action="/api/actions" method="post" className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-3">
      <input type="hidden" name="action" value="agents-set-service" />
      <input type="hidden" name="role" value={role} />
      <label className="text-[11px] text-slate-500">
        AI / service
        <select
          name="service"
          value={svc}
          onChange={(event) => {
            const id = event.target.value
            setSvc(id)
            const next = services.find((item) => item.id === id)?.models ?? []
            setMdl(next[0] ?? '')
          }}
          className="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
        >
          {services.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label className="text-[11px] text-slate-500">
        Model
        <select
          name="model"
          value={mdl}
          onChange={(event) => setMdl(event.target.value)}
          className="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
        >
          {models.map((item) => <option key={item} value={item}>{item}</option>)}
          {!models.includes(mdl) && <option value={mdl}>{mdl}</option>}
        </select>
      </label>
      <button className="rounded border border-cyan-700 bg-cyan-950/30 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-950/60">Switch</button>
    </form>
  )
}
