import { describe, expect, it } from 'vitest'
import { publishWorkflow } from './workflowPublish'

describe('publishWorkflow', () => {
  it.each(['draft', 'validated', 'ready'])('stops after a failed gate from %s', async (status) => {
    let calls = 0
    const failure = new Error('Workflow changed by another editor')
    await expect(publishWorkflow({
      read: async () => ({ status, documentVersion: 7 }),
      transition: async () => { calls++; throw failure },
    })).rejects.toBe(failure)
    expect(calls).toBe(1)
  })

  it('does not transition when the latest workflow cannot be read', async () => {
    let calls = 0
    await expect(publishWorkflow({
      read: async () => { throw new Error('Not authorized') },
      transition: async () => { calls++; return { status: 'published' } },
    })).rejects.toThrow('Not authorized')
    expect(calls).toBe(0)
  })

  it.each(['draft', 'validated', 'ready', 'published'] as const)('publishes from %s without replaying completed gates', async (initial) => {
    let status: string = initial
    let version = 3
    const transitions: Record<string, [string, string]> = {
      draft: ['validate', 'validated'], validated: ['mark_ready', 'ready'], ready: ['publish', 'published'],
    }
    const result = await publishWorkflow({
      read: async () => ({ status, documentVersion: version }),
      transition: async (action, expectedVersion) => {
        expect(expectedVersion).toBe(version)
        if (transitions[status]?.[0] !== action) throw new Error('Invalid transition')
        status = transitions[status]![1]
        return { status, documentVersion: ++version }
      },
    })
    expect(result.status).toBe('published')
  })

  it('preserves a failed gate error and allows a fresh attempt from partial progress', async () => {
    let status = 'draft'
    let failing = true
    const failure = new Error('Validation details must reach the UI')
    const port = {
      read: async () => ({ status }),
      transition: async (action: string) => {
        if (action === 'validate' && status === 'draft') status = 'validated'
        else if (action === 'mark_ready' && status === 'validated') {
          if (failing) throw failure
          status = 'ready'
        } else if (action === 'publish' && status === 'ready') status = 'published'
        else throw new Error('Invalid transition')
        return { status }
      },
    }
    await expect(publishWorkflow(port)).rejects.toBe(failure)
    expect(status).toBe('validated')
    failing = false
    expect((await publishWorkflow(port)).status).toBe('published')
  })

  it.each(['archived', 'superseded'])('does not activate %s implicitly', async (status) => {
    await expect(publishWorkflow({
      read: async () => ({ status }),
      transition: async () => { throw new Error('Must not transition') },
    })).rejects.toThrow(/draft/i)
  })
})
