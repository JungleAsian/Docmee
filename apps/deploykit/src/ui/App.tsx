import { useCallback, useEffect, useState } from 'react'
import { Welcome } from './steps/Welcome.js'
import { SystemCheck } from './steps/SystemCheck.js'
import { Configuration } from './steps/Configuration.js'
import { Installing } from './steps/Installing.js'
import { Complete } from './steps/Complete.js'
import {
  onInstallerProgress,
  openDashboard,
  runSystemCheck,
  startInstall,
  type SystemCheckItem,
} from './installer-bridge.js'
import { emptyConfig, type InstallerConfig } from '../steps/configure.js'
import type { InstallerState } from '../main.js'

const APP_VERSION = '0.1.0'
const DASHBOARD_URL = 'http://localhost:3000'

type View = 'welcome' | 'system-check' | 'configuration' | 'progress'

const INITIAL_STATE: InstallerState = {
  step: 'welcome',
  progress: 0,
  message: '',
  config: emptyConfig(),
}

export function App() {
  const [view, setView] = useState<View>('welcome')
  const [config, setConfig] = useState<InstallerConfig>(emptyConfig)
  const [checks, setChecks] = useState<SystemCheckItem[]>([])
  const [checking, setChecking] = useState(false)
  const [state, setState] = useState<InstallerState>(INITIAL_STATE)

  const goToSystemCheck = useCallback(async () => {
    setView('system-check')
    setChecking(true)
    try {
      setChecks(await runSystemCheck())
    } catch (error) {
      setChecks([{ name: 'System check', ok: false, detail: error instanceof Error ? error.message : String(error) }])
    } finally {
      setChecking(false)
    }
  }, [])

  const updateConfig = useCallback((key: keyof InstallerConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }, [])

  const beginInstall = useCallback(async () => {
    setView('progress')
    setState({ ...INITIAL_STATE, step: 'system-check', config })
    const unlisten = await onInstallerProgress(setState)
    try {
      await startInstall(config)
    } catch (error) {
      setState((prev) => ({ ...prev, step: 'error', error: error instanceof Error ? error.message : String(error) }))
    } finally {
      unlisten()
    }
  }, [config])

  useEffect(() => {
    if (state.step === 'complete') {
      void openDashboard(DASHBOARD_URL).catch(() => undefined)
    }
  }, [state.step])

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col p-8">
      <main className="flex-1 rounded-2xl bg-white p-8 shadow-sm">
        {view === 'welcome' && <Welcome version={APP_VERSION} onInstall={goToSystemCheck} />}
        {view === 'system-check' && (
          <SystemCheck items={checks} loading={checking} onBack={() => setView('welcome')} onContinue={() => setView('configuration')} />
        )}
        {view === 'configuration' && (
          <Configuration config={config} onChange={updateConfig} onBack={() => setView('system-check')} onContinue={beginInstall} />
        )}
        {view === 'progress' && (state.step === 'complete' || state.step === 'error' ? (
          <Complete
            dashboardUrl={DASHBOARD_URL}
            error={state.error}
            onOpen={() => void openDashboard(DASHBOARD_URL).catch(() => undefined)}
            onRetry={() => setView('configuration')}
          />
        ) : (
          <Installing state={state} />
        ))}
      </main>
    </div>
  )
}
