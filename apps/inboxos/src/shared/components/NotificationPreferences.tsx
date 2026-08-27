'use client'

// Req 24 — Notification preferences. Lets a clinic user mute the EMAIL channel for
// non-urgent alert types (the bell feed always records everything; urgent p1 alerts
// always email and are shown here as "Always", non-mutable). Persists to
// PUT /user/notification-preferences.
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { PillToggle } from './PillToggle'
import { useI18n } from '../hooks/useI18n'
import { useFeatures } from '../hooks/useFeatures'
import {
  ALERT_TYPES,
  MUTABLE_ALERT_TYPES,
  SOUND_CATEGORY_KEYS,
  SOUND_PRESETS,
  alertLabelKey,
  alertPriority,
} from '../notifications'
import type { AlertCategoryKey, NotificationPrefs, SoundPreset } from '../types'

function previewSound(preset: SoundPreset, volume: number) {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const ctx = new AudioContextClass(); const now = ctx.currentTime; const gain = ctx.createGain()
    gain.gain.setValueAtTime(Math.max(0.001, Math.min(1, volume)) * 0.06, now); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35); gain.connect(ctx.destination)
    const frequencies: Record<SoundPreset, number[]> = { default: [880, 1174], chime: [1046, 1318, 1568], ping: [1568], bell: [659, 988] }
    frequencies[preset].forEach((frequency, index) => { const oscillator = ctx.createOscillator(); oscillator.frequency.value = frequency; oscillator.connect(gain); oscillator.start(now + index * 0.1); oscillator.stop(now + index * 0.1 + 0.16) })
    window.setTimeout(() => void ctx.close().catch(() => undefined), 600)
  } catch { /* autoplay restrictions are expected; the control remains safe */ }
}

const MUTABLE = new Set(MUTABLE_ALERT_TYPES)

export function NotificationPreferences() {
  const { t } = useI18n()
  const { features } = useFeatures()
  const qc = useQueryClient()
  const key = ['notification-prefs']

  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ preferences: NotificationPrefs }>('/user/notification-preferences'),
  })

  const [emailEnabled, setEmailEnabled] = useState(true)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [soundId, setSoundId] = useState<SoundPreset>('default')
  const [volume, setVolume] = useState(0.7)
  const [soundPresets, setSoundPresets] = useState<Partial<Record<AlertCategoryKey, SoundPreset>>>({})
  const [muted, setMuted] = useState<Set<string>>(new Set())

  // Seed the form once the saved prefs load.
  useEffect(() => {
    const prefs = query.data?.preferences
    if (!prefs) return
    setEmailEnabled(prefs.emailEnabled)
    setSoundEnabled(prefs.soundEnabled)
    setSoundId(prefs.soundId ?? 'default')
    setVolume(typeof prefs.volume === 'number' ? Math.min(1, Math.max(0, prefs.volume)) : 0.7)
    setSoundPresets(prefs.soundPresets ?? {})
    setMuted(new Set(prefs.mutedTypes))
  }, [query.data])

  const save = useMutation({
    mutationFn: (body: NotificationPrefs) => api.put('/user/notification-preferences', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  function toggleMuted(type: string) {
    setMuted((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  function onSave() {
    save.mutate({
      emailEnabled,
      soundEnabled,
      soundId,
      volume,
      soundPresets,
      // Only mutable (non-p1) types can be muted; never persist a p1 mute.
      mutedTypes: [...muted].filter((type) => MUTABLE.has(type)),
    })
  }

  if (query.isLoading) return <p className="text-sm text-gray-400">{t('common.loading')}</p>

  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{t('notif.prefs.emailEnabled')}</span>
        <PillToggle
          checked={emailEnabled}
          label={t('notif.prefs.emailEnabled')}
          onChange={setEmailEnabled}
        />
      </label>
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('notif.prefs.emailHint')}</p>

      {features.notificationChimes && (
        <>
          <label className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-800">
            <span className="flex items-center gap-2">
              <span aria-hidden>🔔</span>
              <span>
                <span className="block font-medium">{t('notif.prefs.soundEnabled')}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{t('notif.prefs.soundHint')}</span>
              </span>
            </span>
            <PillToggle
              checked={soundEnabled}
              label={t('notif.prefs.soundEnabled')}
              onChange={setSoundEnabled}
            />
          </label>

          {soundEnabled && (
            <div className="rounded-md border border-gray-200 p-3 dark:border-gray-800">
              <div className="mb-3 flex items-center justify-between gap-3 text-sm">
                <label htmlFor="notification-volume" className="text-xs font-medium">Volume</label>
                <input id="notification-volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Notification volume" />
                <span className="w-10 text-right text-xs text-gray-500">{Math.round(volume * 100)}%</span>
              </div>
              <div className="mb-3 flex items-center justify-between gap-2 text-sm">
                <span className="text-xs font-medium">Default chime</span>
                <select value={soundId} onChange={(e) => setSoundId(e.target.value as SoundPreset)} className="rounded-md border border-gray-300 bg-transparent px-2 py-1 text-xs dark:border-gray-700" aria-label="Default notification chime">
                  {SOUND_PRESETS.map((preset) => <option key={preset} value={preset}>{t(`notif.sound.${preset}` as const)}</option>)}
                </select>
                <button type="button" onClick={() => previewSound(soundId, volume)} className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700">Test</button>
              </div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t('notif.prefs.soundsTitle')}
              </p>
              <ul className="mt-2 space-y-1.5">
                {SOUND_CATEGORY_KEYS.map((category) => (
                  <li key={category} className="flex items-center justify-between gap-2 text-sm">
                    <span>{t(`notif.category.${category}` as const)}</span>
                    <select
                      value={soundPresets[category] ?? 'default'}
                      onChange={(e) =>
                        setSoundPresets((prev) => ({ ...prev, [category]: e.target.value as SoundPreset }))
                      }
                      className="rounded-md border border-gray-300 bg-transparent px-2 py-1 text-xs dark:border-gray-700"
                    >
                      {SOUND_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>
                          {t(`notif.sound.${preset}` as const)}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t('notif.prefs.emailFor')}
        </p>
        <ul className="space-y-1.5">
          {ALERT_TYPES.map((type) => {
            const mutable = MUTABLE.has(type)
            const urgent = alertPriority(type) === 'p1'
            return (
              <li key={type} className="flex items-center justify-between text-sm">
                <span className={urgent ? 'text-gray-500' : ''}>{t(alertLabelKey(type))}</span>
                {mutable ? (
                  <PillToggle
                    checked={emailEnabled && !muted.has(type)}
                    disabled={!emailEnabled}
                    label={t(alertLabelKey(type))}
                    onChange={() => toggleMuted(type)}
                    size="sm"
                  />
                ) : (
                  <span className="text-xs text-gray-400">{t('notif.prefs.alwaysOn')}</span>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">{t('notif.prefs.urgentNote')}</p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={save.isPending}
          className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {t('common.save')}
        </button>
        {save.isSuccess && <span className="text-xs text-green-600">{t('notif.prefs.saved')}</span>}
        {save.isError && <span className="text-xs text-red-600">{t('notif.prefs.saveError')}</span>}
      </div>
    </div>
  )
}
