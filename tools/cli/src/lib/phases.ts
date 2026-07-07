export type PhaseBuilder = 'claude-code'
export type PhaseStatus = 'not-started' | 'in-progress' | 'done'
export type PromptStatus = 'draft' | 'ready' | 'locked'

export type PhaseDefinition = {
  id: string
  name: string
  builder: PhaseBuilder
  businessPhase: 1 | 2 | 3
  promptStatus: PromptStatus
  notionPageId: string
}

export type PhaseState = {
  id: string
  status: PhaseStatus
  startedAt?: string
  completedAt?: string
  commitHash?: string
  committedAt?: string
}

export const phaseDefinitions: PhaseDefinition[] = [
  { id: 'P01', name: 'Repository Foundation', builder: 'claude-code', businessPhase: 1, promptStatus: 'ready', notionPageId: '38241c470daf812396f7d3589da3c8f7' },
  { id: 'P02', name: 'Database', builder: 'claude-code', businessPhase: 1, promptStatus: 'ready', notionPageId: '38241c470daf819e8da3fde35dccab24' },
  { id: 'P03', name: 'Core Infrastructure + AI', builder: 'claude-code', businessPhase: 1, promptStatus: 'ready', notionPageId: '38241c470daf8125b6efe20b8b8021b3' },
  { id: 'P04', name: 'WhatsApp Channel', builder: 'claude-code', businessPhase: 1, promptStatus: 'ready', notionPageId: '38241c470daf81539a88cc29476d5572' },
  { id: 'P05', name: 'Clinic Bot', builder: 'claude-code', businessPhase: 1, promptStatus: 'ready', notionPageId: '38241c470daf81afa778e7b99fc52cdf' },
  { id: 'P06', name: 'Appointment Scheduler', builder: 'claude-code', businessPhase: 1, promptStatus: 'ready', notionPageId: '38241c470daf8160a7a1c8d00168b570' },
  { id: 'P07', name: 'Secretary Alerts', builder: 'claude-code', businessPhase: 1, promptStatus: 'ready', notionPageId: '38241c470daf8162bb75ddebf8833e34' },
  { id: 'P08', name: 'Auth & API', builder: 'claude-code', businessPhase: 1, promptStatus: 'ready', notionPageId: '38241c470daf8156bf1cd1aaed1df6f0' },
  { id: 'P09', name: 'Clinic Inbox + Admin Studio', builder: 'claude-code', businessPhase: 1, promptStatus: 'ready', notionPageId: '38241c470daf816e93c4cc11e50b31fe' },
  { id: 'P10', name: 'License Manager', builder: 'claude-code', businessPhase: 1, promptStatus: 'ready', notionPageId: '38241c470daf815cb114f6ea353fce80' },
  { id: 'P11', name: 'Admin Studio Admin Panel', builder: 'claude-code', businessPhase: 1, promptStatus: 'ready', notionPageId: '38241c470daf81309766da41278750de' },
  { id: 'P12', name: 'Voice Transcription Service', builder: 'claude-code', businessPhase: 1, promptStatus: 'ready', notionPageId: '38241c470daf81cda0d6e22f4f43b03a' },
  { id: 'P13', name: 'Installer (DeployKit)', builder: 'claude-code', businessPhase: 2, promptStatus: 'ready', notionPageId: '38241c470daf81e388c7f6c3624ede68' },
  { id: 'P14', name: 'Facebook Messenger', builder: 'claude-code', businessPhase: 2, promptStatus: 'ready', notionPageId: '38241c470daf81e994dcfc29f116f3c8' },
  { id: 'P15', name: 'Instagram Direct', builder: 'claude-code', businessPhase: 2, promptStatus: 'ready', notionPageId: '38241c470daf81c2b726fdc002b5628f' },
  { id: 'P16', name: 'Phase 2 Features', builder: 'claude-code', businessPhase: 2, promptStatus: 'ready', notionPageId: '38241c470daf817bad45eda0920188aa' },
  { id: 'P17', name: 'Testing & CI/CD', builder: 'claude-code', businessPhase: 2, promptStatus: 'ready', notionPageId: '38241c470daf815bac4fcca194ee3382' },
  { id: 'P18', name: 'Phase 3 Features', builder: 'claude-code', businessPhase: 3, promptStatus: 'ready', notionPageId: '38241c470daf8108ad51dbe1f5ca6159' },
  { id: 'P19', name: 'Compliance & Launch', builder: 'claude-code', businessPhase: 1, promptStatus: 'ready', notionPageId: '38241c470daf812ca4fec2739fbf8f5b' }
]

export function defaultPhaseState(): PhaseState[] {
  return phaseDefinitions.map((phase) => ({ id: phase.id, status: 'not-started' }))
}

export function phaseFileName(id: string) {
  return `${id}-CODEX-PROMPT.md`
}

