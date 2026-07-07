import { describe, expect, it } from 'vitest'
import { LIFECYCLE_ORDER, lifecycleSteps } from './lifecycle'

describe('lifecycleSteps', () => {
  it('covers all seven statuses in order', () => {
    const steps = lifecycleSteps('open')
    expect(steps.map((s) => s.status)).toEqual(LIFECYCLE_ORDER)
    expect(steps).toHaveLength(7)
  })

  it('marks the current status and splits done / upcoming around it', () => {
    const steps = lifecycleSteps('assigned')
    const byStatus = Object.fromEntries(steps.map((s) => [s.status, s.state]))
    expect(byStatus.open).toBe('done')
    expect(byStatus.pending).toBe('done')
    expect(byStatus.assigned).toBe('current')
    expect(byStatus.handoff).toBe('upcoming')
    expect(byStatus.resolved).toBe('upcoming')
  })

  it('marks everything done before the terminal status', () => {
    const steps = lifecycleSteps('archived')
    expect(steps.filter((s) => s.state === 'done')).toHaveLength(6)
    expect(steps[6]!.state).toBe('current')
  })

  it('shows no current step for an unknown status', () => {
    const steps = lifecycleSteps(undefined)
    expect(steps.every((s) => s.state === 'upcoming')).toBe(true)
  })
})
