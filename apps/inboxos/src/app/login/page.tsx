'use client'

// Login screen. Posts credentials to /auth/login, stores the session (tokens +
// user + panel language) and routes to the user's default surface.
import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/shared/api/client'
import { useAuthStore } from '@/shared/store/auth'
import { useI18n } from '@/shared/hooks/useI18n'
import { LanguageToggle } from '@/shared/components/LanguageToggle'
import type { AuthUser, PanelLanguage } from '@/shared/types'

interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: AuthUser & { panelLanguage?: PanelLanguage }
}

export default function LoginPage() {
  const router = useRouter()
  const { t } = useI18n()
  const setSession = useAuthStore((s) => s.setSession)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signupMode, setSignupMode] = useState(false)
  const [signupClinicName, setSignupClinicName] = useState('')
  const [signupFullName, setSignupFullName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupContactNumber, setSignupContactNumber] = useState('')
  const [signupSuccess, setSignupSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // The api client sets this flag when a token refresh fails and it has to bounce
  // the user back here — show why, instead of an unexplained redirect.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('docmee-session-expired')) {
        setNotice(t('login.sessionExpired'))
        sessionStorage.removeItem('docmee-session-expired')
      }
      if (sessionStorage.getItem('docmee-inactivity-timeout')) {
        setNotice(t('login.inactivityTimeout'))
        sessionStorage.removeItem('docmee-inactivity-timeout')
      }
    } catch {
      /* sessionStorage unavailable — non-fatal */
    }
  }, [t])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await api.post<LoginResponse>('/auth/login', { email, password }, { anonymous: true })
      setSession({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        user: {
          id: res.user.id,
          email: res.user.email,
          fullName: res.user.fullName,
          role: res.user.role,
          clinicId: res.user.clinicId,
          inactivityTimeoutMinutes: res.user.inactivityTimeoutMinutes,
          jzelEnabled: res.user.jzelEnabled,
        },
        language: res.user.panelLanguage,
      })
      router.replace(res.user.role === 'ia_studio_admin' ? '/studio/clinics' : '/inbox')
    } catch (err) {
      setError(err instanceof ApiError ? t('login.error') : t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  async function onSignupSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSignupSuccess(false)
    setLoading(true)
    try {
      await api.post(
        '/auth/signup',
        {
          clinicName: signupClinicName,
          fullName: signupFullName,
          email: signupEmail,
          contactNumber: signupContactNumber,
        },
        { anonymous: true },
      )
      setSignupSuccess(true)
      setSignupClinicName('')
      setSignupFullName('')
      setSignupEmail('')
      setSignupContactNumber('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main data-docmee-auth-shell className="docmee-auth-shell">
      <section className="docmee-auth-card" aria-busy={loading}>
        <div className="docmee-auth-loading-panel" aria-hidden="true">
          <img className="docmee-auth-logo" src="/brand/docmee-logo-auth.svg?v=20260630-markclose" alt="" />
          <div className="docmee-auth-robot-wrap">
            <div className="docmee-auth-robot-glow" />
            <div className="docmee-auth-robot" />
          </div>
          <div className="docmee-auth-progress">
            <span />
          </div>
          <p className="docmee-auth-message">
            <span>Docmee.</span> Your AI booking agent, with simplicity in mind.
          </p>
        </div>

        <div className="docmee-auth-form-panel">
          {loading && (
            <div className="docmee-auth-loading-overlay" role="status" aria-live="polite">
              <div className="docmee-auth-robot-wrap docmee-auth-robot-wrap-sm">
                <div className="docmee-auth-robot-glow" />
                <div className="docmee-auth-robot" />
              </div>
              <div className="docmee-auth-progress">
                <span />
              </div>
              <p>{signupMode ? t('login.signupSubmit') : t('login.loading')}</p>
            </div>
          )}

        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[var(--crm-text-main)]">{signupMode ? t('login.signupTitle') : t('login.title')}</h1>
            <p className="mt-1 text-sm text-[var(--crm-text-muted)]">{signupMode ? t('login.signupSubtitle') : t('login.subtitle')}</p>
          </div>
          <div className="shrink-0">
            <LanguageToggle />
          </div>
        </div>

        {notice && (
          <p role="status" className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {notice}
          </p>
        )}

        {signupSuccess && (
          <p role="status" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            {t('login.signupSuccess')}
          </p>
        )}

        <form onSubmit={signupMode ? onSignupSubmit : onSubmit} className={signupMode ? 'space-y-3' : 'space-y-4'}>
          {signupMode && (
            <>
              <div>
                <label htmlFor="clinicName" className="mb-1 block text-sm font-medium">
                  {t('login.clinicName')}
                </label>
                <input
                  id="clinicName"
                  type="text"
                  required
                  maxLength={80}
                  pattern="[\p{L}\p{M}\p{N} .,'&()\-]+"
                  value={signupClinicName}
                  onChange={(e) => setSignupClinicName(e.target.value)}
                  className="docmee-auth-input"
                />
              </div>
              <div>
                <label htmlFor="fullName" className="mb-1 block text-sm font-medium">
                  {t('login.fullName')}
                </label>
                <input
                  id="fullName"
                  type="text"
                  required
                  maxLength={80}
                  pattern="[\p{L}\p{M}\p{N} .,'&()\-]+"
                  autoComplete="name"
                  value={signupFullName}
                  onChange={(e) => setSignupFullName(e.target.value)}
                  className="docmee-auth-input"
                />
              </div>
            </>
          )}
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              {signupMode ? t('login.emailAddress') : t('login.email')}
            </label>
            <input
              id="email"
              type="email"
              required
              maxLength={254}
              autoComplete={signupMode ? 'email' : 'username'}
              value={signupMode ? signupEmail : email}
              onChange={(e) => (signupMode ? setSignupEmail(e.target.value) : setEmail(e.target.value))}
              className="docmee-auth-input"
            />
          </div>
          <div>
            {signupMode ? (
              <>
                <label htmlFor="contactNumber" className="mb-1 block text-sm font-medium">
                  {t('login.contactNumber')}
                </label>
                <input
                  id="contactNumber"
                  type="tel"
                  required
                  minLength={7}
                  maxLength={24}
                  inputMode="tel"
                  autoComplete="tel"
                  pattern="[0-9+()\-.\s]{7,24}"
                  value={signupContactNumber}
                  onChange={(e) => setSignupContactNumber(e.target.value)}
                  className="docmee-auth-input"
                />
              </>
            ) : (
              <>
                <label htmlFor="password" className="mb-1 block text-sm font-medium">
                  {t('login.password')}
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="docmee-auth-input"
                />
              </>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="docmee-auth-primary-btn"
          >
            {loading ? t('login.loading') : signupMode ? t('login.signupSubmit') : t('login.submit')}
          </button>
          <button
            type="button"
            onClick={() => {
              setSignupMode((value) => !value)
              setError(null)
              setSignupSuccess(false)
            }}
            className="docmee-auth-secondary-btn"
          >
            {signupMode ? t('login.backToLogin') : t('login.signupButton')}
          </button>
        </form>
        </div>
      </section>
    </main>
  )
}
