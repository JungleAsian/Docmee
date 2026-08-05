import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, createHistory, pushHistory, redoHistory, replacePresent, undoHistory } from './workflowHistory'

describe('workflowHistory', () => {
  it('pushes, undoes and redoes snapshots', () => {
    let h = createHistory('a')
    h = pushHistory(h, 'b')
    h = pushHistory(h, 'c')
    expect(h.present).toBe('c')
    expect(canUndo(h)).toBe(true)

    h = undoHistory(h)
    expect(h.present).toBe('b')
    expect(canRedo(h)).toBe(true)

    h = undoHistory(h)
    expect(h.present).toBe('a')
    expect(canUndo(h)).toBe(false)
    // Undo on an empty stack is a no-op, not a crash.
    expect(undoHistory(h).present).toBe('a')

    h = redoHistory(h)
    expect(h.present).toBe('b')
    h = redoHistory(h)
    expect(h.present).toBe('c')
    expect(canRedo(h)).toBe(false)
    expect(redoHistory(h).present).toBe('c')
  })

  it('clears the redo stack when a new step is pushed after an undo', () => {
    let h = pushHistory(createHistory('a'), 'b')
    h = undoHistory(h)
    h = pushHistory(h, 'z')
    expect(h.present).toBe('z')
    expect(canRedo(h)).toBe(false)
  })

  it('coalesces bursts via replacePresent without adding a step', () => {
    let h = createHistory('a')
    h = pushHistory(h, 'b')
    h = replacePresent(h, 'b1')
    h = replacePresent(h, 'b2')
    expect(h.past).toHaveLength(1)
    expect(undoHistory(h).present).toBe('a')
  })

  it('caps the past at the history limit', () => {
    let h = createHistory(0)
    for (let i = 1; i <= 150; i++) h = pushHistory(h, i, 100)
    expect(h.past).toHaveLength(100)
    expect(h.present).toBe(150)
    for (let i = 0; i < 100; i++) h = undoHistory(h)
    expect(h.present).toBe(50)
    expect(canUndo(h)).toBe(false)
  })
})
