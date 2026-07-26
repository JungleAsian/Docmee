import type { BrandIconName } from '@/shared/components/BrandIcon'

export type ClinicAiProvider = 'claude' | 'openai' | 'gemini' | 'custom'

export interface ClinicAiProviderStatus {
  provider: ClinicAiProvider
  connected: boolean
  source: 'clinic' | 'none'
  last4: string | null
  validatedAt: string | null
}

export interface GlobalAiProviderStatus {
  provider: 'openai' | 'anthropic'
  configured: boolean
  fallback: boolean
}

export interface AiProviderSummary {
  icon: BrandIconName
  state: 'ready' | 'missing' | 'fallback'
  source: 'clinic' | 'global' | 'none'
}

const CLINIC_PROVIDER_ICONS: Record<ClinicAiProvider, BrandIconName> = {
  claude: 'claude',
  openai: 'openai',
  gemini: 'gemini',
  custom: 'customAi',
}

export function summarizeAiProviderReadiness(
  clinicProviders: ClinicAiProviderStatus[],
  globalProviders: GlobalAiProviderStatus[],
): AiProviderSummary {
  const clinicProvider = clinicProviders.find((provider) => provider.connected)
  if (clinicProvider) {
    return {
      icon: CLINIC_PROVIDER_ICONS[clinicProvider.provider],
      state: 'ready',
      source: 'clinic',
    }
  }

  const globalProvider = globalProviders.find((provider) => provider.configured)
  if (globalProvider) {
    return {
      icon: globalProvider.provider,
      state: globalProvider.fallback ? 'fallback' : 'ready',
      source: 'global',
    }
  }

  return {
    icon: 'openai',
    state: 'missing',
    source: 'none',
  }
}
