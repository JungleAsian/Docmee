export type NoCodeBuilderKind = 'automations' | 'custom_flows' | 'workflows'

export interface NoCodeBuilderInfo {
  kind: NoCodeBuilderKind
  titleKey: string
  descKey: string
  fitKey: string
  href: string
}

export interface NoCodeStepInfo {
  labelKey: string
  descKey: string
  targetKind: NoCodeBuilderKind
}

export const NO_CODE_BUILDERS: NoCodeBuilderInfo[] = [
  {
    kind: 'automations',
    titleKey: 'nocode.builder.automations.title',
    descKey: 'nocode.builder.automations.desc',
    fitKey: 'nocode.builder.automations.fit',
    href: '/studio/automations',
  },
  {
    kind: 'custom_flows',
    titleKey: 'nocode.builder.customFlows.title',
    descKey: 'nocode.builder.customFlows.desc',
    fitKey: 'nocode.builder.customFlows.fit',
    href: '/studio/custom-flows',
  },
  {
    kind: 'workflows',
    titleKey: 'nocode.builder.workflows.title',
    descKey: 'nocode.builder.workflows.desc',
    fitKey: 'nocode.builder.workflows.fit',
    href: '/studio/workflows',
  },
]

export const VOICE_BOOKING_NO_CODE_STEPS: NoCodeStepInfo[] = [
  {
    labelKey: 'nocode.voice.step.automation',
    descKey: 'nocode.voice.step.automation.desc',
    targetKind: 'automations',
  },
  {
    labelKey: 'nocode.voice.step.workflow',
    descKey: 'nocode.voice.step.workflow.desc',
    targetKind: 'workflows',
  },
  {
    labelKey: 'nocode.voice.step.flow',
    descKey: 'nocode.voice.step.flow.desc',
    targetKind: 'custom_flows',
  },
]
