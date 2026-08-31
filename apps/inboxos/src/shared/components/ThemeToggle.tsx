'use client'

import { useEffect, useState } from 'react'
import { useI18n } from '../hooks/useI18n'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'docmee-theme'

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    const nextTheme = readInitialTheme()
    setTheme(nextTheme)
    applyTheme(nextTheme)
  }, [])

  const toggleTheme = () => {
    setTheme((current) => {
      const nextTheme = current === 'dark' ? 'light' : 'dark'
      window.localStorage.setItem(STORAGE_KEY, nextTheme)
      applyTheme(nextTheme)
      return nextTheme
    })
  }

  if (compact) {
    return (
      <button
        type="button"
        aria-label={theme === 'dark' ? t('theme.useLight') : t('theme.useDark')}
        title={theme === 'dark' ? t('theme.useLight') : t('theme.useDark')}
        onClick={toggleTheme}
        className="crm-nav-item crm-theme-toggle-compact"
      >
        <span aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-label={theme === 'dark' ? t('theme.useLight') : t('theme.useDark')}
      title={theme === 'dark' ? t('theme.useLight') : t('theme.useDark')}
      onClick={toggleTheme}
      className="crm-theme-toggle focus:outline-none focus:ring-2 focus:ring-[var(--crm-primary-color)] focus:ring-offset-2 focus:ring-offset-[var(--crm-sidebar-bg)]"
    >
      <span className="crm-theme-icon" aria-hidden="true">☾</span>
      <span className="crm-theme-track" aria-hidden="true">
        <span className="crm-theme-thumb" />
      </span>
      <span className="crm-theme-icon" aria-hidden="true">☼</span>
    </button>
  )
}
