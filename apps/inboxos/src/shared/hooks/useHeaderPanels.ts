'use client'

import { useCallback, useState } from 'react'
import { changeHeaderPanel, type HeaderPanel } from '../headerPanels'

export function useHeaderPanels() {
  const [panel, setPanel] = useState<HeaderPanel | null>(null)
  const setCustomizeOpen = useCallback((open: boolean | ((current: boolean) => boolean)) => {
    setPanel((current) => changeHeaderPanel(current, 'customize', typeof open === 'function' ? open(current === 'customize') : open))
  }, [])
  const setUpdatesOpen = useCallback((open: boolean) => setPanel((current) => changeHeaderPanel(current, 'updates', open)), [])
  return { customizeOpen: panel === 'customize', setCustomizeOpen, updatesOpen: panel === 'updates', setUpdatesOpen }
}
