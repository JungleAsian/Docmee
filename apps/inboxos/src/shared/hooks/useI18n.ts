'use client'

// Panel language hook (Gap #15). Reads the language from the auth store and
// exposes a memoised `t()`. Changing the language updates the store immediately
// and best-effort persists it to the server (POST /user/preferences).
import { useCallback } from 'react'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'
import { translate, type TranslationKey } from '../i18n'
import type { PanelLanguage } from '../types'

export function useI18n() {
  const language = useAuthStore((s) => s.language)
  const setLanguage = useAuthStore((s) => s.setLanguage)
  const isAuthed = useAuthStore((s) => Boolean(s.accessToken))

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language],
  )

  const changeLanguage = useCallback(
    (next: PanelLanguage) => {
      setLanguage(next)
      if (isAuthed) {
        api.post('/user/preferences', { panel_language: next }).catch(() => {
          // The local preference is already applied; server persistence is best-effort.
        })
      }
    },
    [setLanguage, isAuthed],
  )

  return { t, language, changeLanguage }
}
