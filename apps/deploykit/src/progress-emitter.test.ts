import { describe, it, expect, vi } from 'vitest'
import { ProgressEmitter } from './progress-emitter.js'

describe('ProgressEmitter', () => {
  it('emits progress events correctly', () => {
    const emitter = new ProgressEmitter()
    const handler = vi.fn()
    emitter.on('progress', handler)

    emitter.progress('downloading', 42, 'Downloading release')

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('downloading', 42, 'Downloading release')
  })

  it('emits error event', () => {
    const emitter = new ProgressEmitter()
    const handler = vi.fn()
    emitter.on('error', handler)

    const boom = new Error('boom')
    emitter.error(boom)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(boom)
  })

  it('emits complete event', () => {
    const emitter = new ProgressEmitter()
    const handler = vi.fn()
    emitter.on('complete', handler)

    emitter.complete()

    expect(handler).toHaveBeenCalledTimes(1)
  })
})
