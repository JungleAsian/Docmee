import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InteractionModeToggle } from './InteractionModeToggle'

const mocks = vi.hoisted(() => ({
  role: 'clinic_admin' as string | undefined,
  pending: false,
  error: false,
  patch: vi.fn(),
  invalidate: vi.fn(),
}))

vi.stubGlobal('React', React)
vi.mock('../api/client', () => ({ api: { patch: mocks.patch } }))
vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { role: mocks.role } }),
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
  useMutation: (options: { mutationFn: (target: string) => Promise<void>; onSettled: () => void }) => ({
    isPending: mocks.pending,
    isError: mocks.error,
    mutate: async (target: string) => {
      await options.mutationFn(target)
      options.onSettled()
    },
  }),
}))

type ButtonProps = { children: React.ReactNode; disabled: boolean; 'aria-pressed': boolean; onClick: () => Promise<void> }

function control(staffOptedOut = false) {
  const tree = InteractionModeToggle({ patientId: 'patient-1', metadata: { staffOptedOut } })
  const group = React.Children.toArray(tree.props.children).find(
    (child) => React.isValidElement<{ role?: string }>(child) && child.props.role === 'group',
  ) as React.ReactElement<{ children: React.ReactNode }> | undefined
  const buttons = React.Children.toArray(group?.props.children).filter(
    (child): child is React.ReactElement<ButtonProps> => React.isValidElement(child) && child.type === 'button',
  )
  return { tree, buttons }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.role = 'clinic_admin'
  mocks.pending = false
  mocks.error = false
})

describe('patient handling selector', () => {
  it('labels the control and shows Secretary before Bot', () => {
    const { tree, buttons } = control()
    const html = renderToStaticMarkup(tree)
    expect(html).toContain('Always handled by')
    expect(html).toContain('aria-label="Always handled by"')
    expect(buttons.map((button) => button.props.children)).toEqual(['Secretary', 'Bot'])
    expect(html).not.toMatch(/Opt-in|Opt-out|Automation/)
  })

  it.each([false, true])('reflects the stored staff-only setting (%s)', (staffOptedOut) => {
    const { buttons } = control(staffOptedOut)
    expect(buttons).toHaveLength(2)
    expect(buttons[0].props['aria-pressed']).toBe(staffOptedOut)
    expect(buttons[1].props['aria-pressed']).toBe(!staffOptedOut)
    expect(buttons[0].props.disabled).toBe(staffOptedOut)
    expect(buttons[1].props.disabled).toBe(!staffOptedOut)
  })

  it('sets the existing staff-only lock when Secretary is selected', async () => {
    await control().buttons[0].props.onClick()
    expect(mocks.patch).toHaveBeenCalledWith('/patients/patient-1/staff-opt-out', { optedOut: true })
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['patient', 'patient-1'] })
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['conversations'] })
  })

  it('clears only the staff lock when Bot is selected', async () => {
    await control(true).buttons[1].props.onClick()
    expect(mocks.patch).toHaveBeenCalledWith('/patients/patient-1/staff-opt-out', { optedOut: false })
  })

  it.each(['doctor', undefined])('keeps unauthorized roles read-only (%s)', (role) => {
    mocks.role = role
    const { tree, buttons } = control()
    expect(buttons).toHaveLength(2)
    expect(buttons.every((button) => button.props.disabled)).toBe(true)
    expect(renderToStaticMarkup(tree)).toContain('View only')
  })

  it('disables changes during a request and retains the error message', () => {
    mocks.pending = true
    mocks.error = true
    const { tree, buttons } = control()
    expect(buttons).toHaveLength(2)
    expect(buttons.every((button) => button.props.disabled)).toBe(true)
    expect(renderToStaticMarkup(tree)).toContain('Interaction change failed. Try again.')
  })
})
