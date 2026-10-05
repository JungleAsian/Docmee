import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

// The chat window can render without a component harness only as source, so this
// guards the wiring that matters: who sees the button, what it opens, and what
// happens after a delete. The password check and clinic scoping are enforced (and
// tested) by the API; the button's role check is a courtesy, not the control.
describe('delete button on the chat window', () => {
  const view = read('./components/ConversationView.tsx')

  it('is shown only to clinic and platform admins, matching the API', () => {
    expect(view).toContain("const canDelete = role === 'clinic_admin' || role === 'ia_studio_admin'")
    expect(view).toContain('{canDelete && conversation && (')
  })

  it('opens the password-confirmed delete dialog for the open conversation', () => {
    expect(view).toContain("import { DeleteConversationDialog } from './DeleteConversationDialog'")
    expect(view).toContain('onClick={() => setDeleteOpen(true)}')
    expect(view).toMatch(/<DeleteConversationDialog\s+open=\{deleteOpen\}\s+conversationId=\{conversationId\}/)
  })

  it('closes the dialog and tells the page after a successful delete', () => {
    expect(view).toMatch(/onDeleted=\{\(\) => \{\s+setDeleteOpen\(false\)\s+onDeleted\?\.\(\)\s+\}\}/)
  })

  it('has an accessible, translated label', () => {
    expect(view).toContain("aria-label={t('view.delete')}")
  })

  it('makes the inbox clear the selection once the conversation is gone', () => {
    const page = read('../app/(clinic)/inbox/page.tsx')
    expect(page).toContain('onDeleted={() => select(null)}')
  })

  it('confirms with a password before the API is called', () => {
    const dialog = read('./components/DeleteConversationDialog.tsx')
    expect(dialog).toContain('api.del(`/conversations/${conversationId}`, { password })')
    expect(dialog).toContain("disabled={!password.trim() || mutation.isPending}")
  })
})
