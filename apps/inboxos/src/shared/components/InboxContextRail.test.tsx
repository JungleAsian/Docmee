import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { clinic: { id: 'clinic-1', settings: {} } } }),
}))
vi.mock('../hooks/useFeatures', () => ({ useFeatures: () => ({ features: { inboxLayoutV2: true, calendarPolicyV2: true } }) }))
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ user: { clinicId: 'clinic-1', role: 'clinic_admin' } }) }))
vi.mock('../hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../hooks/useUserUiPreferences', () => ({
  useUserUiPreferences: () => ({
    preferences: {
      sideRailItemOrder: {
        main: ['patient', 'calendar', 'notes', 'others'],
        others: ['customTags'],
      },
      hiddenSideRailItems: [],
    },
  }),
}))
vi.mock('../permissions', () => ({ can: () => true }))
vi.mock('./PatientInfoCard', () => ({ PatientInfoCard: () => <div>Patient information</div> }))
vi.mock('./AppointmentBookingCard', () => ({ AppointmentBookingCard: () => <div>Booking calendar</div> }))
vi.mock('./CustomTagManager', () => ({ CustomTagManager: () => <div>Custom conversation tags</div> }))
vi.mock('./NotesPanel', () => ({ NotesPanel: () => <div>Internal notes</div> }))
vi.mock('./SafetyHandoffPanel', () => ({ SafetyHandoffPanel: () => <div /> }))
vi.mock('./LifecyclePanel', () => ({ LifecyclePanel: () => <div /> }))
vi.mock('./AssignPanel', () => ({ AssignPanel: () => <div /> }))
vi.mock('./TagsPanel', () => ({ TagsPanel: () => <div /> }))
vi.mock('./AssistantPanel', () => ({ AssistantPanel: () => <div /> }))

describe('InboxContextRail', () => {
  it('keeps internal notes above the booking calendar even with older saved ordering', async () => {
    vi.stubGlobal('React', React)
    const { InboxContextRail } = await import('./InboxContextRail')
    const markup = renderToStaticMarkup(React.createElement(InboxContextRail, { conversationId: 'conversation-1' }))

    expect(markup.indexOf('Internal notes')).toBeLessThan(markup.indexOf('Booking calendar'))
    expect(markup.indexOf('Booking calendar')).toBeLessThan(markup.indexOf('inbox.others'))
  })
})
