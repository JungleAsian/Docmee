'use client'

// Keeps <html lang> in sync with the panel language so screen readers announce
// content with the right pronunciation when the user toggles ES/EN. The layout
// renders a static lang for SSR; this updates it on the client after hydration.
import { useEffect } from 'react'
import { useAuthStore } from '@/shared/store/auth'

export function HtmlLangSync() {
  const language = useAuthStore((s) => s.language)
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])
  return null
}
