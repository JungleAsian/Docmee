'use client'

// Admin Studio — Clinic user management (Req 1). Pick a clinic, then list / add /
// edit / delete its panel users and assign their role (secretary / doctor /
// clinic admin). The logged-in admin cannot demote, deactivate or delete their
// own account — those guards are enforced on the API too.
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/shared/api/client'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { PillToggle } from '@/shared/components/PillToggle'
import { BackButton } from '@/shared/components/BackButton'
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import { useAuthStore } from '@/shared/store/auth'
import {
  ASSIGNABLE_ROLES,
  DEFAULT_ROLE_MENU_VISIBILITY,
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_MENU_ITEMS,
  ROLE_PERMISSIONS,
  readRoleMenuVisibility,
  readRolePermissions,
  type RoleAccessSettings,
  type RoleMenuItemKey,
  type RoleMenuVisibility,
  type RolePermissionKey,
  type RolePermissions,
} from '@/shared/roleAccess'
import type { TranslationKey } from '@/shared/i18n'
import type { AssignableRole, ClinicUser, ClinicUserStatus, PanelLanguage } from '@/shared/types'

const ROLES = ASSIGNABLE_ROLES
const STATUSES: ClinicUserStatus[] = ['active', 'inactive', 'invited']
const ALERT_CATEGORIES = ['whatsapp', 'internal', 'newBooking', 'cancellation', 'bookingRevision'] as const
type AlertCategoryKey = (typeof ALERT_CATEGORIES)[number]
type AlertCategories = Record<AlertCategoryKey, boolean>
const DEFAULT_ALERT_CATEGORIES: AlertCategories = {
  whatsapp: true,
  internal: true,
  newBooking: true,
  cancellation: true,
  bookingRevision: true,
}
const DEFAULT_INACTIVITY_TIMEOUT_MINUTES = 30

function readAlertCategories(user: ClinicUser): AlertCategories {
  return {
    ...DEFAULT_ALERT_CATEGORIES,
    ...(user.notificationPrefs?.alertCategories ?? {}),
  }
}

function readSoundEnabled(user: ClinicUser): boolean {
  return user.notificationPrefs?.soundEnabled === true
}

function readJzelEnabled(user: ClinicUser): boolean {
  return user.notificationPrefs?.jzelEnabled !== false
}

function readInactivityTimeout(user: Pick<ClinicUser, 'inactivityTimeoutMinutes'>): number {
  return user.inactivityTimeoutMinutes || DEFAULT_INACTIVITY_TIMEOUT_MINUTES
}

type ClinicSettings = RoleAccessSettings
type ClinicResponse = { clinic: { id: string; settings?: ClinicSettings | null } }
const ROLE_ACCESS_DEFAULTS = {
  rolePermissions: DEFAULT_ROLE_PERMISSIONS,
  roleMenuVisibility: DEFAULT_ROLE_MENU_VISIBILITY,
} as const

export default function UsersPage() {
  const { t } = useI18n()
  const { clinicId, switchClinic } = useActiveClinic()

  const key = ['clinic-users', clinicId]
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ users: ClinicUser[] }>(`/clinics/${clinicId}/users`),
  })
  const clinicQuery = useQuery({
    queryKey: ['clinic', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<ClinicResponse>(`/clinics/${clinicId}`),
  })

  const users = query.data?.users ?? []
  const settings: ClinicSettings = clinicQuery.data?.clinic.settings ?? {}

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <BackButton href="/studio" label={t('nav.studio')} />
          <h1 className="text-xl font-bold">{t('studio.users.title')}</h1>
        </div>
        <ClinicSelect value={clinicId} onChange={switchClinic} label={t('studio.usage.selectClinic')} />
      </div>

      {!clinicId ? (
        <p className="text-sm text-gray-400">{t('studio.users.selectClinic')}</p>
      ) : (
        <>
          <NewUserForm clinicId={clinicId} />

          <RoleAccessPanel
            clinicId={clinicId}
            settings={settings}
            loading={clinicQuery.isLoading}
            title={t('studio.users.permissionsTitle')}
            hint={t('studio.users.permissionsHint')}
            firstColumn={t('studio.users.permission')}
            items={ROLE_PERMISSIONS}
            values={readRolePermissions(settings)}
            settingKey="rolePermissions"
            labelForItem={(item) => t(`studio.users.permission.${item}` as TranslationKey)}
          />

          <RoleAccessPanel
            clinicId={clinicId}
            settings={settings}
            loading={clinicQuery.isLoading}
            title={t('studio.users.menuTitle')}
            hint={t('studio.users.menuHint')}
            firstColumn={t('studio.users.menuItem')}
            items={ROLE_MENU_ITEMS}
            values={readRoleMenuVisibility(settings)}
            settingKey="roleMenuVisibility"
            labelForItem={(item) => t(`studio.users.menu.${item}` as TranslationKey)}
          />

          {query.isLoading ? (
            <p className="text-sm text-gray-400">{t('common.loading')}</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-gray-400">{t('studio.users.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {users.map((u) => (
                <UserRow key={u.id} clinicId={clinicId} user={u} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  const { t } = useI18n()
  return (
    <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-950 dark:text-teal-300">
      {t(`studio.users.role.${role}`)}
    </span>
  )
}

function StatusBadge({ status }: { status: ClinicUserStatus }) {
  const { t } = useI18n()
  const tone =
    status === 'active'
      ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
      : status === 'invited'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{t(`studio.users.status.${status}`)}</span>
}

type AccessValueMap = RolePermissions | RoleMenuVisibility

function RoleAccessPanel<T extends RolePermissionKey | RoleMenuItemKey>({
  clinicId,
  settings,
  loading,
  title,
  hint,
  firstColumn,
  items,
  values,
  settingKey,
  labelForItem,
}: {
  clinicId: string
  settings: ClinicSettings
  loading: boolean
  title: string
  hint: string
  firstColumn: string
  items: readonly T[]
  values: Record<T, AssignableRole[]>
  settingKey: 'rolePermissions' | 'roleMenuVisibility'
  labelForItem: (item: T) => string
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: (next: AccessValueMap) =>
      api.patch(`/clinics/${clinicId}`, {
        settings: {
          ...settings,
          [settingKey]: next,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clinic', clinicId] }),
  })

  function toggle(item: T, role: AssignableRole) {
    const current = values[item]
    const nextRoles = current.includes(role) ? current.filter((item) => item !== role) : [...current, role]
    save.mutate({
      ...values,
      [item]: nextRoles,
    } as AccessValueMap)
  }

  function resetDefaults() {
    save.mutate(ROLE_ACCESS_DEFAULTS[settingKey] as AccessValueMap)
  }

  return (
    <section className="clinic-card mb-6 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs text-gray-400">{hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(loading || save.isPending) && <span className="text-xs text-gray-400">{t('common.saving')}</span>}
          <button
            type="button"
            onClick={resetDefaults}
            disabled={loading || save.isPending}
            className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            Reset defaults
          </button>
        </div>
      </div>
      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-xs">
          <thead className="text-gray-400">
            <tr>
              <th className="py-2 pr-3 font-medium">{firstColumn}</th>
              {ROLES.map((role) => (
                <th key={role} className="px-3 py-2 text-center font-medium">
                  {t(`studio.users.role.${role}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item} className="border-t border-gray-100 dark:border-gray-800">
                <td className="py-3 pr-3 text-gray-600 dark:text-gray-300">
                  {labelForItem(item)}
                </td>
                {ROLES.map((role) => {
                  const checked = values[item].includes(role)
                  return (
                    <td key={role} className="px-3 py-3 text-center">
                      <PillToggle
                        checked={checked}
                        disabled={loading || save.isPending}
                        label={`${t(`studio.users.role.${role}`)}: ${labelForItem(item)}`}
                        onChange={() => toggle(item, role)}
                        size="sm"
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 grid gap-2 md:hidden">
        {items.map((item) => (
          <div key={item} className="rounded-md border border-gray-200 p-3 dark:border-gray-800">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{labelForItem(item)}</p>
            <div className="mt-2 grid gap-2">
              {ROLES.map((role) => {
                const checked = values[item].includes(role)
                return (
                  <label
                    key={role}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
                  >
                    <span>{t(`studio.users.role.${role}`)}</span>
                    <PillToggle
                      checked={checked}
                      disabled={loading || save.isPending}
                      label={`${t(`studio.users.role.${role}`)}: ${labelForItem(item)}`}
                      onChange={() => toggle(item, role)}
                      size="sm"
                    />
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 border-t border-gray-100 pt-3 text-xs dark:border-gray-800 sm:grid-cols-3">
        {ROLES.map((role) => {
          const enabled = items.filter((item) => values[item].includes(role)).length
          return (
            <div key={role} className="rounded-md bg-gray-50 p-2 dark:bg-gray-950">
              <p className="font-semibold text-gray-700 dark:text-gray-200">{t(`studio.users.role.${role}`)}</p>
              <p className="mt-0.5 text-gray-500 dark:text-gray-400">
                {enabled}/{items.length} enabled
              </p>
            </div>
          )
        })}
      </div>
      {save.isError && <p className="mt-2 text-xs text-red-600">{t('studio.users.permissionsError')}</p>}
    </section>
  )
}

function UserRow({ clinicId, user }: { clinicId: string; user: ClinicUser }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const selfId = useAuthStore((s) => s.user?.id)
  const isSelf = selfId === user.id
  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState(user.fullName ?? '')
  const [email, setEmail] = useState(user.email)
  const [role, setRole] = useState<AssignableRole>(
    ROLES.includes(user.role as AssignableRole) ? (user.role as AssignableRole) : 'secretary',
  )
  const [status, setStatus] = useState<ClinicUserStatus>(user.status)
  const [inactivityTimeoutMinutes, setInactivityTimeoutMinutes] = useState(() => readInactivityTimeout(user))
  const [alertCategories, setAlertCategories] = useState<AlertCategories>(() => readAlertCategories(user))
  const [soundEnabled, setSoundEnabled] = useState(() => readSoundEnabled(user))
  const [jzelEnabled, setJzelEnabled] = useState(() => readJzelEnabled(user))
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch(`/clinics/${clinicId}/users/${user.id}`, {
        fullName: fullName.trim() || undefined,
        email,
        role,
        status,
        inactivityTimeoutMinutes,
        alertCategories,
        soundEnabled,
        jzelEnabled,
        ...(password ? { password } : {}),
      }),
    onSuccess: (data) => {
      const updatedUser = data as { user?: ClinicUser }
      if (isSelf && updatedUser.user) {
        useAuthStore.getState().setUser({
          id: updatedUser.user.id,
          email: updatedUser.user.email,
          fullName: updatedUser.user.fullName,
          role: updatedUser.user.role,
          clinicId: updatedUser.user.clinicId,
          inactivityTimeoutMinutes: updatedUser.user.inactivityTimeoutMinutes,
          jzelEnabled: readJzelEnabled(updatedUser.user),
        })
      }
      setEditing(false)
      setPassword('')
      setError('')
      qc.invalidateQueries({ queryKey: ['clinic-users', clinicId] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.del(`/clinics/${clinicId}/users/${user.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clinic-users', clinicId] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  })

  function startEdit() {
    setFullName(user.fullName ?? '')
    setEmail(user.email)
    setRole(ROLES.includes(user.role as AssignableRole) ? (user.role as AssignableRole) : 'secretary')
    setStatus(user.status)
    setInactivityTimeoutMinutes(readInactivityTimeout(user))
    setAlertCategories(readAlertCategories(user))
    setSoundEnabled(readSoundEnabled(user))
    setJzelEnabled(readJzelEnabled(user))
    setPassword('')
    setError('')
    setEditing(true)
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-teal-200 bg-white p-3 dark:border-teal-900 dark:bg-gray-900">
        <div className="grid gap-2 md:grid-cols-[1fr_1.15fr_auto_auto]">
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t('studio.users.fullName')}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('studio.users.email')}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AssignableRole)}
            disabled={isSelf}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 disabled:opacity-60"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`studio.users.role.${r}`)}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ClinicUserStatus)}
            disabled={isSelf}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 disabled:opacity-60"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`studio.users.status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('studio.users.newPassword')}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
          />
          <label className="flex min-w-0 items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5 text-sm dark:border-gray-800">
            <span className="shrink-0 text-xs text-gray-500">{t('studio.users.inactivityTimeout')}</span>
            <input
              type="number"
              min={1}
              max={480}
              value={inactivityTimeoutMinutes}
              onChange={(e) => setInactivityTimeoutMinutes(Number(e.target.value) || DEFAULT_INACTIVITY_TIMEOUT_MINUTES)}
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-center text-sm dark:border-gray-700 dark:bg-gray-800"
            />
            <span className="shrink-0 text-xs text-gray-400">{t('studio.users.minutes')}</span>
          </label>
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
          <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-800/70 dark:text-gray-400">
            {t('studio.users.inactivityHint')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={updateMutation.isPending || !email.trim()}
              onClick={() => updateMutation.mutate()}
              className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
        <label className="mt-2 flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-800">
          <span className="min-w-0">
            <span className="block font-medium">Show J.zel</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              Hide the floating J.zel chat avatar for this user when this is off.
            </span>
          </span>
          <PillToggle
            checked={jzelEnabled}
            disabled={updateMutation.isPending}
            label="Show J.zel"
            onChange={setJzelEnabled}
          />
        </label>
        <div className="mt-3 rounded-md border border-gray-200 p-3 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{t('studio.users.alertsTitle')}</p>
              <p className="text-xs text-gray-400">{t('studio.users.alertsHint')}</p>
            </div>
            <span className="text-xs text-gray-400">
              {ALERT_CATEGORIES.filter((key) => alertCategories[key]).length}/{ALERT_CATEGORIES.length}
            </span>
          </div>
          <label className="mt-3 flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-800">
            <span className="flex items-center gap-2">
              <span aria-hidden>🔔</span>
              <span>
                <span className="block font-medium">{t('notif.prefs.soundEnabled')}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{t('notif.prefs.soundHint')}</span>
              </span>
            </span>
            <PillToggle
              checked={soundEnabled}
              disabled={updateMutation.isPending}
              label={t('notif.prefs.soundEnabled')}
              onChange={setSoundEnabled}
            />
          </label>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ALERT_CATEGORIES.map((key) => (
              <label
                key={key}
                className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
              >
                <span>{t(`studio.users.alert.${key}` as TranslationKey)}</span>
                <PillToggle
                  checked={alertCategories[key]}
                  disabled={updateMutation.isPending}
                  label={t(`studio.users.alert.${key}` as TranslationKey)}
                  onChange={(checked) =>
                    setAlertCategories((current) => ({
                      ...current,
                      [key]: checked,
                    }))
                  }
                  size="sm"
                />
              </label>
            ))}
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </li>
    )
  }

  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="min-w-0">
        <p className="font-medium">
          {user.fullName || user.email}
          {isSelf && <span className="ml-2 text-xs text-gray-400">{t('studio.users.you')}</span>}
        </p>
        <p className="mt-0.5 truncate text-xs text-gray-500">{user.email}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <RoleBadge role={user.role} />
          <StatusBadge status={user.status} />
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {t('studio.users.alertsSummary')}: {ALERT_CATEGORIES.filter((key) => readAlertCategories(user)[key]).length}/{ALERT_CATEGORIES.length}
          {readSoundEnabled(user) ? ` • ${t('notif.prefs.soundShort')}` : ''}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {t('studio.users.inactivitySummary')}: {readInactivityTimeout(user)} {t('studio.users.minutes')}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          J.zel: {readJzelEnabled(user) ? 'Visible' : 'Hidden'}
        </p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={startEdit}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {t('common.edit')}
        </button>
        {!isSelf && (
          <button
            type="button"
            onClick={() => {
              if (confirm(t('studio.users.deleteConfirm'))) deleteMutation.mutate()
            }}
            className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
          >
            {t('common.delete')}
          </button>
        )}
      </div>
    </li>
  )
}

function NewUserForm({ clinicId }: { clinicId: string }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AssignableRole>('secretary')
  const [language, setLanguage] = useState<PanelLanguage>('es')
  const [inactivityTimeoutMinutes, setInactivityTimeoutMinutes] = useState(DEFAULT_INACTIVITY_TIMEOUT_MINUTES)
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/clinics/${clinicId}/users`, {
        fullName: fullName.trim() || undefined,
        email,
        password: password || undefined,
        role,
        panelLanguage: language,
        inactivityTimeoutMinutes,
      }),
    onSuccess: () => {
      setFullName('')
      setEmail('')
      setPassword('')
      setRole('secretary')
      setInactivityTimeoutMinutes(DEFAULT_INACTIVITY_TIMEOUT_MINUTES)
      setError('')
      qc.invalidateQueries({ queryKey: ['clinic-users', clinicId] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (email.trim()) mutation.mutate()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="clinic-card mb-6 p-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Add new user</p>
        <p className="text-xs text-gray-400">{t('studio.users.quickSetup')}</p>
      </div>
      <div className="grid gap-2 lg:grid-cols-[1fr_1.2fr_1fr_auto_auto_auto_auto]">
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-gray-400">
          <span>{t('studio.users.fullName')}</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t('studio.users.fullName')}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal text-white dark:border-gray-700 dark:bg-gray-800"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-gray-400">
          <span>{t('studio.users.email')}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('studio.users.email')}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal text-white dark:border-gray-700 dark:bg-gray-800"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-gray-400">
          <span>{t('studio.users.passwordOptional')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('studio.users.passwordOptional')}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal text-white dark:border-gray-700 dark:bg-gray-800"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-gray-400">
          <span>Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AssignableRole)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal text-white dark:border-gray-700 dark:bg-gray-800"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`studio.users.role.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-gray-400">
          <span>Language</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as PanelLanguage)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal text-white dark:border-gray-700 dark:bg-gray-800"
          >
            <option value="es">{t('studio.users.lang.es')}</option>
            <option value="en">{t('studio.users.lang.en')}</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-gray-400">
          <span>{t('studio.users.inactivityTimeout')}</span>
          <div className="flex min-w-0 items-center gap-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800">
            <span className="text-xs text-gray-500">{t('studio.users.inactivityShort')}</span>
            <input
              type="number"
              min={1}
              max={480}
              value={inactivityTimeoutMinutes}
              aria-label={t('studio.users.inactivityTimeout')}
              onChange={(e) => setInactivityTimeoutMinutes(Number(e.target.value) || DEFAULT_INACTIVITY_TIMEOUT_MINUTES)}
              className="w-16 bg-transparent text-center font-normal text-white outline-none"
            />
            <span className="text-xs text-gray-400">{t('studio.users.minutes')}</span>
          </div>
        </label>
        <button
          type="submit"
          disabled={mutation.isPending || !email.trim()}
          className="self-end rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          Add user
        </button>
      </div>
      {role === 'doctor' && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t('studio.users.doctorHint')}</p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  )
}
