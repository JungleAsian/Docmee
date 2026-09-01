'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

type PageHeroActionsContextValue = {
  actions: ReactNode
  setActions: (actions: ReactNode) => void
}

const PageHeroActionsContext = createContext<PageHeroActionsContextValue | null>(null)

export function PageHeroActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActionsState] = useState<ReactNode>(null)
  const setActions = useCallback((next: ReactNode) => setActionsState(next), [])
  const value = useMemo(() => ({ actions, setActions }), [actions, setActions])

  return <PageHeroActionsContext.Provider value={value}>{children}</PageHeroActionsContext.Provider>
}

export function useCurrentPageHeroActions() {
  return useContext(PageHeroActionsContext)?.actions ?? null
}

export function usePageHeroActions(actions: ReactNode) {
  const context = useContext(PageHeroActionsContext)
  const setActions = context?.setActions

  useEffect(() => {
    if (!setActions) return
    setActions(actions)
    return () => setActions(null)
  }, [actions, setActions])
}
