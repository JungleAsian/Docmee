'use client'

// Panel language toggle (Gap #15). Two-button ES/EN switch wired to useI18n,
// which persists the choice via POST /user/preferences when authenticated.
import { useI18n } from '../hooks/useI18n'
import { LANGUAGES } from '../i18n'

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { language, changeLanguage } = useI18n()
  if (compact) {
    const nextLanguage = language === 'en' ? 'es' : 'en'
    return (
      <button
        type="button"
        onClick={() => changeLanguage(nextLanguage)}
        aria-label={language === 'en' ? 'Cambiar a español' : 'Switch to English'}
        title={language === 'en' ? 'Cambiar a español' : 'Switch to English'}
        className="crm-nav-item crm-language-toggle-compact"
      >
        <span>{language.toUpperCase()}</span>
      </button>
    )
  }

  return (
    <div className="inline-flex w-fit self-start overflow-hidden rounded-md border border-[var(--crm-border-color)] bg-[var(--crm-input-bg)] text-xs">
      {LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => changeLanguage(lang)}
          aria-pressed={language === lang}
          className={
            language === lang
              ? 'bg-[var(--crm-primary-color)] px-3 py-1.5 font-semibold uppercase text-white'
              : 'px-3 py-1.5 uppercase text-[var(--crm-text-muted)] hover:bg-[var(--crm-hover-bg)] hover:text-[var(--crm-text-main)]'
          }
        >
          {lang}
        </button>
      ))}
    </div>
  )
}
