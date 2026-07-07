import { Command } from 'commander'
import { readJson, writeJson } from '../lib/json-store.js'
import { loadConfig } from '../lib/config.js'
import { log } from '../lib/logger.js'

type AgentMode = 'manual' | 'api' | 'cli'
type Trigger = 'after-each-phase' | 'after-migration' | 'on-demand'
type Agent = {
  id: string
  role: string
  label: string
  service: string
  model: string
  mode: AgentMode
  trigger: Trigger
  enabled: boolean
  core: boolean
  prompt: string
  lastRun?: { phase?: string; status: string; createdAt: string }
}

type AgentService = {
  id: string
  label: string
  provider: string
  mode: AgentMode
  env?: string
  models: string[]
}

export const agentServices: AgentService[] = [
  { id: 'claude-code', label: 'Claude Code', provider: 'Anthropic', mode: 'cli', models: ['claude-sonnet-4-6', 'claude-opus-4-6'] },
  { id: 'claude-api', label: 'Claude API live runtime', provider: 'Anthropic', mode: 'api', env: 'ANTHROPIC_API_KEY', models: ['claude-sonnet-4-6', 'claude-haiku-4-5'] },
  { id: 'codex-pro', label: 'Codex Pro', provider: 'OpenAI', mode: 'manual', env: 'OPENAI_API_KEY', models: ['o3', 'o4-mini'] },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI', mode: 'api', env: 'OPENAI_API_KEY', models: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'] },
  { id: 'google-gemini', label: 'Gemini', provider: 'Google', mode: 'api', env: 'GOOGLE_GEMINI_API_KEY', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] },
  { id: 'grok', label: 'Grok', provider: 'xAI', mode: 'api', env: 'GROK_API_KEY', models: ['grok-3', 'grok-2-latest'] },
  { id: 'cursor', label: 'Cursor', provider: 'Cursor', mode: 'manual', models: ['auto'] },
  { id: 'glm', label: 'GLM', provider: 'Zhipu', mode: 'api', env: 'GLM_API_KEY', models: ['glm-4-flash', 'glm-4'] },
  { id: 'mistral', label: 'Mistral', provider: 'Mistral', mode: 'api', env: 'MISTRAL_API_KEY', models: ['mistral-large', 'codestral'] },
  { id: 'deepseek', label: 'DeepSeek', provider: 'DeepSeek', mode: 'api', env: 'DEEPSEEK_API_KEY', models: ['deepseek-chat', 'deepseek-coder'] },
  { id: 'custom', label: 'Custom', provider: 'Any', mode: 'api', env: 'CUSTOM_AI_API_KEY', models: ['custom'] }
]

const prompts: Record<string, string> = {
  'backend-builder': 'Build backend phases from the Notion prompt, then run gates before marking a phase complete.',
  'frontend-builder': 'Build frontend phases P09 and P11 from the Notion prompt, preserving accessibility and responsive layout.',
  'code-reviewer': 'Review TypeScript, module boundaries, security issues, and high-risk behavior changes.',
  'test-writer': 'Add Vitest coverage using LLM_STUB=true and focus on critical paths.',
  'doc-writer': 'Update module documentation, setup notes, and operational instructions after implementation.',
  'security-auditor': 'Check hardcoded secrets, SQL injection, HMAC validation, RLS gaps, and JWT handling.',
  'database-optimizer': 'Review migrations for missing indexes, RLS policies, pgvector setup, and query risks.',
  'ui-ux-reviewer': 'Review WCAG 2.1 AA, dark theme consistency, mobile behavior, and Tailwind implementation.'
}

function defaults(): Agent[] {
  return [
    {
      id: 'backend-builder',
      role: 'backend-builder',
      label: 'Backend Builder',
      service: 'claude-code',
      model: 'claude-sonnet-4-6',
      mode: 'cli',
      trigger: 'on-demand',
      enabled: true,
      core: true,
      prompt: prompts['backend-builder']
    },
    {
      id: 'frontend-builder',
      role: 'frontend-builder',
      label: 'Frontend Builder',
      service: 'claude-code',
      model: 'claude-sonnet-4-6',
      mode: 'cli',
      trigger: 'on-demand',
      enabled: true,
      core: true,
      prompt: prompts['frontend-builder']
    },
    {
      id: 'code-reviewer',
      role: 'code-reviewer',
      label: 'Code Reviewer',
      service: 'claude-api',
      model: 'claude-sonnet-4-6',
      mode: 'api',
      trigger: 'after-each-phase',
      enabled: false,
      core: false,
      prompt: prompts['code-reviewer']
    },
    {
      id: 'test-writer',
      role: 'test-writer',
      label: 'Test Writer',
      service: 'gpt-4o',
      model: 'gpt-4o',
      mode: 'api',
      trigger: 'after-each-phase',
      enabled: false,
      core: false,
      prompt: prompts['test-writer']
    },
    {
      id: 'doc-writer',
      role: 'doc-writer',
      label: 'Documentation Writer',
      service: 'claude-api',
      model: 'claude-sonnet-4-6',
      mode: 'api',
      trigger: 'after-each-phase',
      enabled: false,
      core: false,
      prompt: prompts['doc-writer']
    },
    {
      id: 'security-auditor',
      role: 'security-auditor',
      label: 'Security Auditor',
      service: 'claude-api',
      model: 'claude-sonnet-4-6',
      mode: 'api',
      trigger: 'after-each-phase',
      enabled: false,
      core: false,
      prompt: prompts['security-auditor']
    },
    {
      id: 'database-optimizer',
      role: 'database-optimizer',
      label: 'Database Optimizer',
      service: 'deepseek',
      model: 'deepseek-coder',
      mode: 'api',
      trigger: 'after-migration',
      enabled: false,
      core: false,
      prompt: prompts['database-optimizer']
    },
    {
      id: 'ui-ux-reviewer',
      role: 'ui-ux-reviewer',
      label: 'UI/UX Reviewer',
      service: 'claude-api',
      model: 'claude-sonnet-4-6',
      mode: 'api',
      trigger: 'after-each-phase',
      enabled: false,
      core: false,
      prompt: prompts['ui-ux-reviewer']
    }
  ]
}

export function readAgents() {
  const stored = readJson<Agent[]>('agents.json', [])
  if (stored.length === 0) {
    const data = defaults()
    writeJson('agents.json', data)
    return data
  }
  const normalized = stored.map((agent) => {
    if (agent.role === 'backend-builder') return { ...agent, service: 'claude-code', model: 'claude-sonnet-4-6', mode: 'cli' as const }
    if (agent.service === 'claude-code') return { ...agent, mode: 'cli' as const }
    return agent
  })
  if (JSON.stringify(normalized) !== JSON.stringify(stored)) writeJson('agents.json', normalized)
  return normalized
}

function saveAgents(agents: Agent[]) {
  writeJson('agents.json', agents)
}

function serviceFor(id: string) {
  return agentServices.find((service) => service.id === id)
}

function updateAgent(role: string, mutate: (agent: Agent) => Agent) {
  const data = readAgents()
  const index = data.findIndex((agent) => agent.role === role || agent.id === role)
  if (index === -1) {
    log('agents', `Agent not found: ${role}`, 'error')
    process.exitCode = 1
    return
  }
  data[index] = mutate(data[index])
  saveAgents(data)
  log('agents', `${data[index].label} updated`)
}

export const agentsCmd = new Command('agents').description('Configure Docmee AI builder and reviewer agents')

agentsCmd.command('list').action(() => {
  loadConfig()
  console.table(readAgents().map((agent) => ({
    role: agent.role,
    label: agent.label,
    service: agent.service,
    model: agent.model,
    trigger: agent.trigger,
    enabled: agent.enabled ? 'yes' : 'no',
    core: agent.core ? 'yes' : 'no'
  })))
})

agentsCmd.command('show').requiredOption('--id <id>').action((opts: { id: string }) => {
  const agent = readAgents().find((item) => item.id === opts.id || item.role === opts.id)
  if (!agent) {
    log('agents', `Agent not found: ${opts.id}`, 'error')
    process.exitCode = 1
    return
  }
  console.log(JSON.stringify(agent, null, 2))
})

agentsCmd.command('enable').requiredOption('--role <role>').action((opts: { role: string }) => {
  updateAgent(opts.role, (agent) => ({ ...agent, enabled: true }))
})

agentsCmd.command('disable').requiredOption('--role <role>').action((opts: { role: string }) => {
  updateAgent(opts.role, (agent) => agent.core ? agent : { ...agent, enabled: false })
})

agentsCmd.command('test').requiredOption('--service <service>').action((opts: { service: string }) => {
  loadConfig()
  const service = serviceFor(opts.service)
  if (!service) {
    log('agents', `Unknown service: ${opts.service}`, 'error')
    process.exitCode = 1
    return
  }
  const ready = service.mode === 'cli' || service.mode === 'manual' || Boolean(service.env && process.env[service.env])
  log('agents', ready ? `${service.label} is configured for ${service.mode} mode` : `${service.label} is missing ${service.env}`, ready ? 'info' : 'warn')
  process.exitCode = ready ? 0 : 1
})

agentsCmd.command('run')
  .requiredOption('--role <role>')
  .option('--phase <phase>', 'Phase ID', 'P01')
  .action((opts: { role: string; phase: string }) => {
    const data = readAgents()
    const index = data.findIndex((agent) => agent.role === opts.role || agent.id === opts.role)
    if (index === -1) {
      log('agents', `Agent not found: ${opts.role}`, 'error')
      process.exitCode = 1
      return
    }
    const agent = data[index]
    if (!agent.enabled) {
      log('agents', `${agent.label} is disabled`, 'warn')
      process.exitCode = 1
      return
    }
    data[index] = { ...agent, lastRun: { phase: opts.phase, status: 'queued/manual-ready', createdAt: new Date().toISOString() } }
    saveAgents(data)
    log('agents', `${agent.label} prepared for ${opts.phase}. Use the configured ${agent.service} workflow to execute the prompt.`)
  })

agentsCmd.command('set')
  .description('Switch an agent to a different AI service / model')
  .requiredOption('--role <role>')
  .option('--service <service>', agentServices.map((service) => service.id).join(' | '))
  .option('--model <model>')
  .action((opts: { role: string; service?: string; model?: string }) => {
    if (opts.service && !serviceFor(opts.service)) {
      log('agents', `Unknown service: ${opts.service}. Use one of: ${agentServices.map((service) => service.id).join(', ')}`, 'error')
      process.exitCode = 1
      return
    }
    updateAgent(opts.role, (agent) => {
      const service = opts.service ? serviceFor(opts.service) : undefined
      return {
        ...agent,
        service: service ? service.id : agent.service,
        mode: service ? service.mode : agent.mode,
        model: opts.model || (service ? (service.models[0] ?? agent.model) : agent.model)
      }
    })
  })

agentsCmd.command('reset').action(() => {
  saveAgents(defaults())
  log('agents', 'Agent configuration reset to defaults')
})
