import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  advanceCancelFlow,
  initialCancelState,
  type CancelContext,
  type CancelDeps,
} from '../calbot/cancel-flow.js'
import type { UpcomingAppointment } from '../calbot/shared.js'

const appointment: UpcomingAppointment = {
  id: 'appt-1',
  providerId: 'prov-1',
  providerName: 'Dra. García',
  date: '2026-07-01',
  time: '10:00',
  googleEventId: 'evt_123',
}

function makeDeps(): CancelDeps {
  return {
    deleteEvent: vi.fn().mockResolvedValue(undefined),
    markCancelled: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('advanceCancelFlow', () => {
  it('presents the appointment and asks for confirmation first', async () => {
    const deps = makeDeps()
    const ctx: CancelContext = { language: 'es', appointment }
    const r = await advanceCancelFlow(initialCancelState(), 'quiero cancelar mi cita', ctx, deps)
    expect(r.done).toBe(false)
    expect(r.reply).toContain('García')
    expect(deps.markCancelled).not.toHaveBeenCalled()
  })

  it('found appointment + confirmed → status cancelled and event deleted', async () => {
    const deps = makeDeps()
    const ctx: CancelContext = { language: 'es', appointment }
    const r = await advanceCancelFlow({ step: 'confirm' }, 'sí, cancela', ctx, deps)
    expect(r.done).toBe(true)
    expect(deps.deleteEvent).toHaveBeenCalledWith('evt_123')
    expect(deps.markCancelled).toHaveBeenCalledWith('appt-1')
  })

  it('declining keeps the appointment', async () => {
    const deps = makeDeps()
    const ctx: CancelContext = { language: 'es', appointment }
    const r = await advanceCancelFlow({ step: 'confirm' }, 'no', ctx, deps)
    expect(r.done).toBe(true)
    expect(deps.markCancelled).not.toHaveBeenCalled()
  })

  it('no upcoming appointment → says so, no side effects', async () => {
    const deps = makeDeps()
    const ctx: CancelContext = { language: 'en', appointment: null }
    const r = await advanceCancelFlow(initialCancelState(), 'cancel please', ctx, deps)
    expect(r.done).toBe(true)
    expect(r.reply).toMatch(/no upcoming appointments/i)
    expect(deps.markCancelled).not.toHaveBeenCalled()
  })
})
