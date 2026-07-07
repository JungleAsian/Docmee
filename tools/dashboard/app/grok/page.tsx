import { AccountSwitchTemplate } from '../account-switch-template'

export const dynamic = 'force-dynamic'

export default function GrokPage() {
  return (
    <AccountSwitchTemplate
      provider="Grok"
      providerKey="grok"
      modelHint="Grok account / xAI API"
      accountEnvKeys={['GROK_API_KEY', 'XAI_API_KEY']}
      consoleUrl="https://grok.com"
    />
  )
}
