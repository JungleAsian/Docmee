import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { translate } from '../i18n'
import { TodayCommandCenter } from './TodayCommandCenter'
import { WabaTableModal } from './WabaTableModal'

vi.stubGlobal('React', React)
vi.mock('next/link', () => ({ default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('../hooks/useI18n', () => ({ useI18n: () => ({ language: 'es', t: (key: string, vars?: Record<string, string | number>) => translate('es', key, vars) }) }))
vi.mock('../hooks/useActiveClinic', () => ({ useActiveClinic: () => ({ clinicId: 'test-clinic' }) }))
vi.mock('../store/auth', () => ({ useAuthStore: (select: any) => select({ user: { id: 'test-user', role: 'admin' } }) }))
vi.mock('../api/client', () => ({ api: { get: vi.fn() } }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false, isError: false }) }))

describe('clinic surface Spanish labels', () => {
  it('translates the daily summary and empty states', () => {
    const html = renderToStaticMarkup(<TodayCommandCenter />)
    expect(html).toContain('Hoy')
    expect(html).toContain('Abrir bandeja de entrada')
    expect(html).toContain('Próxima cita')
    expect(html).toContain('No hay citas activas programadas para hoy.')
    expect(html).not.toContain('Next patient action')
  })

  it('translates account controls and statuses without translating account names or IDs', () => {
    const html = renderToStaticMarkup(<WabaTableModal open accounts={[{ id: 'test', displayName: 'Clinic-authored name', accountId: 'phone-id', status: 'inactive' }]} selectedId="test" onSelect={() => {}} onAddNew={() => {}} onClose={() => {}} />)
    expect(html).toContain('Cuentas de WhatsApp Business')
    expect(html).toContain('Inactiva')
    expect(html).toContain('Seleccionada')
    expect(html).toContain('Clinic-authored name')
    expect(html).toContain('phone-id')
    expect(html).not.toContain('not saved')
  })
})
