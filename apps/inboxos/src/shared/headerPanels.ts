export type HeaderPanel = 'customize' | 'updates'

export function changeHeaderPanel(current: HeaderPanel | null, panel: HeaderPanel, open: boolean): HeaderPanel | null {
  return open ? panel : current === panel ? null : current
}
