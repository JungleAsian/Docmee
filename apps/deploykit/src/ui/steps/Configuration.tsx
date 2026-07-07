import type { InstallerConfig } from '../../steps/configure.js'

interface FieldDef {
  key: keyof InstallerConfig
  label: string
  helper: string
  helperUrl?: string
  required: boolean
}

const FIELDS: FieldDef[] = [
  { key: 'supabaseUrl', label: 'Supabase URL', helper: 'Project settings → API', helperUrl: 'https://supabase.com/dashboard', required: true },
  { key: 'supabaseAnonKey', label: 'Supabase Anon Key', helper: 'Project settings → API', required: false },
  { key: 'supabaseServiceKey', label: 'Supabase Service Key', helper: 'Project settings → API (service_role)', required: true },
  { key: 'anthropicApiKey', label: 'Anthropic API Key', helper: 'console.anthropic.com → API Keys', helperUrl: 'https://console.anthropic.com', required: true },
  { key: 'deepseekApiKey', label: 'DeepSeek API Key', helper: 'platform.deepseek.com', required: false },
  { key: 'deepgramApiKey', label: 'Deepgram API Key', helper: 'console.deepgram.com', required: false },
  { key: 'resendApiKey', label: 'Resend API Key', helper: 'resend.com → API Keys', required: false },
  { key: 'metaAppSecret', label: 'Meta App Secret', helper: 'Meta for Developers → App → Settings', helperUrl: 'https://developers.facebook.com', required: true },
  { key: 'metaVerifyToken', label: 'Meta Verify Token', helper: 'Any string you set on the webhook', required: true },
  { key: 'redisUrl', label: 'Redis URL', helper: 'Defaults to redis://127.0.0.1:6379', required: false },
  { key: 'jwtSecret', label: 'JWT Secret', helper: 'Long random string', required: true },
  { key: 'jwtRefreshSecret', label: 'JWT Refresh Secret', helper: 'Long random string (different from above)', required: true },
  { key: 'licenseKey', label: 'License Key', helper: 'Issued by Admin Studio', required: true },
]

interface ConfigurationProps {
  config: InstallerConfig
  onChange: (key: keyof InstallerConfig, value: string) => void
  onBack: () => void
  onContinue: () => void
}

export function Configuration({ config, onChange, onBack, onContinue }: ConfigurationProps) {
  const missingRequired = FIELDS.some((field) => field.required && config[field.key].trim() === '')

  return (
    <div className="flex h-full flex-col gap-5">
      <header>
        <h2 className="text-xl font-semibold text-slate-900">Configuration</h2>
        <p className="text-sm text-slate-500">These values are written to the Docmee .env file.</p>
      </header>

      <div className="flex-1 overflow-y-auto pr-1">
        <div className="grid gap-4">
          {FIELDS.map((field) => (
            <label key={field.key} className="flex flex-col gap-1">
              <span className="text-sm font-medium text-slate-800">
                {field.label}
                {field.required && <span className="ml-1 text-rose-500">*</span>}
              </span>
              <input
                type="password"
                value={config[field.key]}
                onChange={(event) => onChange(field.key, event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
              />
              <span className="text-xs text-slate-400">
                {field.helper}
                {field.helperUrl && (
                  <>
                    {' · '}
                    <a href={field.helperUrl} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">
                      open
                    </a>
                  </>
                )}
              </span>
            </label>
          ))}
        </div>
      </div>

      <footer className="flex justify-between">
        <button type="button" onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700">
          Back
        </button>
        <button
          type="button"
          disabled={missingRequired}
          onClick={onContinue}
          className="rounded-lg bg-sky-600 px-6 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Install
        </button>
      </footer>
    </div>
  )
}
