type PublishState = { status: string; documentVersion?: number }
type PublishAction = 'validate' | 'mark_ready' | 'publish'

/** Read server state on every attempt so a failed multi-step publish can resume. */
export async function publishWorkflow<T extends PublishState>(port: {
  read: () => Promise<T>
  transition: (action: PublishAction, expectedVersion?: number) => Promise<T>
}): Promise<T> {
  let workflow = await port.read()
  for (const [status, action] of [['draft', 'validate'], ['validated', 'mark_ready'], ['ready', 'publish']] as const) {
    if (workflow.status === status) workflow = await port.transition(action, workflow.documentVersion)
  }
  if (workflow.status !== 'published') throw new Error('This workflow cannot be published in its current state. Restore an archived workflow, or edit a draft before publishing.')
  return workflow
}
