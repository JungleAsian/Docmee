import { AccountSwitchTemplate } from '../account-switch-template'

export const dynamic = 'force-dynamic'

export default function GeminiPage() {
  return (
    <AccountSwitchTemplate
      provider="Gemini"
      providerKey="gemini"
      modelHint="Gemini account / Google AI Studio"
      accountEnvKeys={['GOOGLE_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_AI_API_KEY']}
      consoleUrl="https://aistudio.google.com"
    />
  )
}
