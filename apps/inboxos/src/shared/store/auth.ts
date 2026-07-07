// Auth store (Zustand, persisted to localStorage). Holds the access + refresh
// tokens, the logged-in user, and the panel language. The api client reads tokens
// from here; the heartbeat + language toggle read/write the language.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthUser, PanelLanguage } from '../types'
import { DEFAULT_LANGUAGE } from '../i18n'

const SESSION_COOKIE = 'docmee-session'
const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60

function setSessionMarker() {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${SESSION_COOKIE}=1; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax${secure}`
}

function clearSessionMarker() {
  if (typeof document === 'undefined') return
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
}

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: AuthUser | null
  language: PanelLanguage
  /**
   * Screen 6 — the clinic the operator is currently working in. Defaults to the
   * user's own clinic on login; an ia_studio_admin may switch it to operate any
   * clinic's inbox/calendar. The api client sends it as the X-Clinic-Id header so
   * the server scopes every clinic request to it (non-admins are pinned server-side
   * to their own clinic, so the header is only an escalation path for admins).
   */
  activeClinicId: string | null
  /** Hydration guard — false until persisted state has loaded on the client. */
  hydrated: boolean
  setSession: (data: {
    accessToken: string
    refreshToken: string
    user: AuthUser
    language?: PanelLanguage
  }) => void
  setAccessToken: (token: string) => void
  setRefreshToken: (token: string) => void
  setLanguage: (language: PanelLanguage) => void
  setUser: (user: AuthUser) => void
  setActiveClinicId: (clinicId: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      language: DEFAULT_LANGUAGE,
      activeClinicId: null,
      hydrated: false,
      setSession: ({ accessToken, refreshToken, user, language }) =>
        // A fresh login always resets the active clinic to the user's own clinic —
        // an admin's previous switch must not carry over to the next session.
        set((s) => {
          setSessionMarker()
          return { accessToken, refreshToken, user, language: language ?? s.language, activeClinicId: user.clinicId }
        }),
      setAccessToken: (accessToken) => {
        setSessionMarker()
        set({ accessToken })
      },
      setRefreshToken: (refreshToken) => {
        setSessionMarker()
        set({ refreshToken })
      },
      setLanguage: (language) => set({ language }),
      setUser: (user) => set({ user }),
      setActiveClinicId: (activeClinicId) => set({ activeClinicId }),
      logout: () => {
        clearSessionMarker()
        set({ accessToken: null, refreshToken: null, user: null, activeClinicId: null })
      },
    }),
    {
      name: 'docmee-auth',
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true
      },
    },
  ),
)

/** Non-reactive snapshot for use outside React (e.g. the api client). */
export const authSnapshot = () => useAuthStore.getState()
