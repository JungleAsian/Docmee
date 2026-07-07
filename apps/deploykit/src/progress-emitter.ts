import { EventEmitter } from 'node:events'

/**
 * Typed event bus used by the installer steps to report progress back to the
 * orchestrator (and, in turn, the Tauri UI). Kept intentionally small so it can
 * be unit-tested without any Tauri or filesystem dependencies (Gap #21).
 */
export class ProgressEmitter extends EventEmitter {
  emit(event: 'progress', step: string, percent: number, message: string): boolean
  emit(event: 'error', error: Error): boolean
  emit(event: 'complete'): boolean
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args)
  }

  progress(step: string, percent: number, message: string): void {
    this.emit('progress', step, percent, message)
  }

  error(err: Error): void {
    this.emit('error', err)
  }

  complete(): void {
    this.emit('complete')
  }
}
