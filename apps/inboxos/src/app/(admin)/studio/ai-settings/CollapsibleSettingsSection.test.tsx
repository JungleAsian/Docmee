import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CollapsibleSettingsSection } from './CollapsibleSettingsSection'

describe('CollapsibleSettingsSection', () => {
  it('starts with its settings hidden behind an accessible show-settings control', () => {
    vi.stubGlobal('React', React)
    const markup = renderToStaticMarkup(
      <CollapsibleSettingsSection
        title="Docmee AI Assistant"
        contentId="docmee-ai-assistant-settings"
        headerActions={<button type="button">Assistant enabled</button>}
      >
        <label>
          AI provider
          <select defaultValue="claude">
            <option value="claude">Claude</option>
          </select>
        </label>
      </CollapsibleSettingsSection>,
    )

    expect(markup).toContain('Docmee AI Assistant')
    expect(markup).toContain('Assistant enabled')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('aria-controls="docmee-ai-assistant-settings"')
    expect(markup).toContain('Show settings')
    expect(markup).not.toContain('AI provider')
  })
})
