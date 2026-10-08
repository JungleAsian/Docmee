import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ScheduledMessageList } from './ScheduledMessages'
vi.stubGlobal('React', React)
vi.mock('../hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
describe('scheduled message list', () => {
  it('offers edit/cancel only for pending rows, never retries unknown delivery', () => {
    const base = { kind: 'text' as const, content: 'hello', templateId: null, scheduledAt: '2026-10-08T15:00:00Z', timezone: 'UTC', version: 1, reasonCode: null, createdAt: '2026-10-07T00:00:00Z' }
    const html = renderToStaticMarkup(<ScheduledMessageList messages={[{ ...base, id: 'a', status: 'pending' }, { ...base, id: 'b', status: 'delivery_unknown' }]} busy={false} enabled onEdit={() => {}} onCancel={() => {}} />)
    expect(html.match(/schedule.edit/g)).toHaveLength(1)
    expect(html.match(/schedule.cancel/g)).toHaveLength(1)
    expect(html).toContain('schedule.unknownHelp')
    expect(html).toContain('<details')
    expect(html).not.toContain('Retry')
  })
  it('keeps cancel available when disabled but hides edit', () => {
    const html = renderToStaticMarkup(<ScheduledMessageList messages={[{ id: 'a', kind: 'text', content: 'hello', templateId: null, scheduledAt: '2026-10-08T15:00:00Z', timezone: 'UTC', version: 1, reasonCode: null, createdAt: '', status: 'pending' }]} busy={false} enabled={false} onEdit={() => {}} onCancel={() => {}} />)
    expect(html).not.toContain('schedule.edit')
    expect(html).toContain('schedule.cancel')
  })
  it('separates sent and cancelled history from the pending panel', () => {
    const base = { kind: 'text' as const, templateId: null, scheduledAt: '2026-10-08T15:00:00Z', timezone: 'UTC', version: 1, reasonCode: null, createdAt: '' }
    const html = renderToStaticMarkup(<ScheduledMessageList messages={[{ ...base, id: 'a', content: 'future', status: 'pending' }, { ...base, id: 'b', content: 'delivered', status: 'sent' }]} busy={false} enabled onEdit={() => {}} onCancel={() => {}} />)
    expect(html).toContain('schedule.history')
    expect(html.indexOf('schedule.history')).toBeGreaterThan(html.indexOf('future'))
    expect(html.indexOf('delivered')).toBeGreaterThan(html.indexOf('schedule.history'))
  })
})
