const state = {
  baseUrl: localStorage.getItem('sentinel.baseUrl') || window.location.origin,
  autoRefresh: localStorage.getItem('sentinel.autoRefresh') !== 'false',
  decisions: JSON.parse(localStorage.getItem('sentinel.decisions') || '{}'),
  issues: [],
  selectedIssue: null,
  timer: null
}

const agents = [
  'Dashboard/UI agent',
  'CLI/build agent',
  'Git/GitHub agent',
  'Notion integration agent',
  'Claude account/session agent',
  'Deployment agent',
  'Diagnostics agent',
  'Manual queue'
]

const providers = ['Claude Code', 'Codex', 'Local model', 'Manual queue']

const elements = {
  baseUrlInput: document.querySelector('#baseUrlInput'),
  saveUrlButton: document.querySelector('#saveUrlButton'),
  setupPanel: document.querySelector('#setupPanel'),
  connectionLabel: document.querySelector('#connectionLabel'),
  refreshButton: document.querySelector('#refreshButton'),
  autoRefreshToggle: document.querySelector('#autoRefreshToggle'),
  heartbeatValue: document.querySelector('#heartbeatValue'),
  phaseValue: document.querySelector('#phaseValue'),
  claudeValue: document.querySelector('#claudeValue'),
  costValue: document.querySelector('#costValue'),
  lastUpdated: document.querySelector('#lastUpdated'),
  criticalCount: document.querySelector('#criticalCount'),
  warningCount: document.querySelector('#warningCount'),
  approvalCount: document.querySelector('#approvalCount'),
  issueList: document.querySelector('#issueList'),
  issueDialog: document.querySelector('#issueDialog'),
  dialogSeverity: document.querySelector('#dialogSeverity'),
  dialogTitle: document.querySelector('#dialogTitle'),
  dialogDiagnosis: document.querySelector('#dialogDiagnosis'),
  dialogEvidence: document.querySelector('#dialogEvidence'),
  agentSelect: document.querySelector('#agentSelect'),
  providerSelect: document.querySelector('#providerSelect'),
  approveButton: document.querySelector('#approveButton'),
  dismissButton: document.querySelector('#dismissButton'),
  closeDialogButton: document.querySelector('#closeDialogButton')
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function apiUrl(path) {
  return `${normalizeBaseUrl(state.baseUrl)}${path}`
}

function saveDecisions() {
  localStorage.setItem('sentinel.decisions', JSON.stringify(state.decisions))
}

function formatMoney(value) {
  return typeof value === 'number' ? `$${value.toFixed(value >= 10 ? 2 : 4)}` : '$0.00'
}

function issueId(category, title) {
  return `${category}:${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function routeFor(category) {
  if (category.includes('claude')) return ['Claude account/session agent', 'Claude Code']
  if (category.includes('dashboard')) return ['Dashboard/UI agent', 'Codex']
  if (category.includes('gate')) return ['CLI/build agent', 'Claude Code']
  if (category.includes('deploy')) return ['Deployment agent', 'Codex']
  return ['Diagnostics agent', 'Codex']
}

function createIssue({ category, severity, title, diagnosis, evidence, approval = true }) {
  const [agent, provider] = routeFor(category)
  const id = issueId(category, title)
  const decision = state.decisions[id] || {}
  return {
    id,
    category,
    severity,
    title,
    diagnosis,
    evidence,
    requiresApproval: approval,
    status: decision.status || 'detected',
    assignedAgent: decision.assignedAgent || agent,
    assignedProvider: decision.assignedProvider || provider
  }
}

function deriveIssues(monitor, ready, metrics) {
  const issues = []
  const heartbeat = monitor?.heartbeat?.status || 'unknown'
  const run = monitor?.run || {}
  const active = monitor?.active || {}
  const phase = run.phase || active.id || metrics?.phase?.current || 'unknown phase'

  if (['dead', 'lost'].includes(heartbeat)) {
    issues.push(createIssue({
      category: 'stale-heartbeat',
      severity: heartbeat === 'dead' ? 'critical' : 'warning',
      title: `Heartbeat ${heartbeat}`,
      diagnosis: `The build heartbeat is ${heartbeat} for ${phase}.`,
      evidence: [`Last message: ${run.message || 'none'}`, `Age: ${run.heartbeatAgeMs || 0}ms`]
    }))
  }

  if (run.status === 'failed' || active.buildStatus === 'failed') {
    issues.push(createIssue({
      category: 'build-failed',
      severity: 'critical',
      title: `Build failed at ${phase}`,
      diagnosis: run.message || active.notes || 'Build Control reports a failed phase.',
      evidence: [`Phase: ${phase}`, `Status: ${run.status || active.buildStatus}`]
    }))
  }

  if (run.status === 'paused') {
    issues.push(createIssue({
      category: 'claude-session-limit',
      severity: 'warning',
      title: `Build paused at ${phase}`,
      diagnosis: run.message || 'Build is paused and may be waiting for a Claude refresh window.',
      evidence: [`Resume at: ${run.resumeAt || 'unknown'}`]
    }))
  }

  if (Number(ready?.critical || 0) > 0) {
    issues.push(createIssue({
      category: 'ready-check-blocker',
      severity: 'critical',
      title: 'Ready Check blocker',
      diagnosis: `Ready Check reports ${ready.critical} critical blocker${ready.critical === 1 ? '' : 's'}.`,
      evidence: [`Warnings: ${ready.warning || 0}`, `Updated: ${ready.updatedAt || 'unknown'}`]
    }))
  }

  if (Number(monitor?.progress?.failed || 0) > 0) {
    issues.push(createIssue({
      category: 'gate-or-phase-failure',
      severity: 'critical',
      title: 'Phase failure detected',
      diagnosis: `${monitor.progress.failed} phase row${monitor.progress.failed === 1 ? '' : 's'} show failed status.`,
      evidence: [`Progress: ${monitor.progress.done}/${monitor.progress.total}`]
    }))
  }

  if (!metrics && !monitor && !ready) {
    issues.push(createIssue({
      category: 'dashboard-route-error',
      severity: 'critical',
      title: 'DevTools API unreachable',
      diagnosis: 'Sentinel could not reach the DevTools APIs.',
      evidence: [`URL: ${state.baseUrl}`]
    }))
  }

  return issues.filter((issue) => issue.status !== 'dismissed' && issue.status !== 'resolved')
}

async function fetchJson(path) {
  const response = await fetch(apiUrl(path), { cache: 'no-store' })
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response.json()
}

async function refresh() {
  elements.refreshButton.classList.add('is-refreshing')
  try {
    const [monitorResult, readyResult, metricsResult] = await Promise.allSettled([
      fetchJson('/api/install-monitor/status'),
      fetchJson('/api/ready/status'),
      fetchJson('/api/project-metrics')
    ])
    const monitor = monitorResult.status === 'fulfilled' ? monitorResult.value : null
    const ready = readyResult.status === 'fulfilled' ? readyResult.value : null
    const metrics = metricsResult.status === 'fulfilled' ? metricsResult.value : null
    state.issues = deriveIssues(monitor, ready, metrics)
    renderStatus(monitor, ready, metrics, true)
    renderIssues()
  } catch (error) {
    state.issues = deriveIssues(null, null, null)
    renderStatus(null, null, null, false, error)
    renderIssues()
  } finally {
    elements.refreshButton.classList.remove('is-refreshing')
  }
}

function renderStatus(monitor, ready, metrics, connected, error) {
  elements.connectionLabel.textContent = connected ? normalizeBaseUrl(state.baseUrl) : `Offline: ${error?.message || 'not connected'}`
  elements.heartbeatValue.textContent = monitor?.heartbeat?.status || '--'
  elements.phaseValue.textContent = monitor?.active?.id || monitor?.run?.phase || metrics?.phase?.current || '--'
  elements.claudeValue.textContent = claudeWindowLabel(monitor)
  elements.costValue.textContent = formatMoney(metrics?.totalCost)
  elements.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`
}

function claudeWindowLabel(monitor) {
  const resetAt = monitor?.claudeUsage?.session?.resetAt
  if (!resetAt) return '--'
  const minutes = Math.max(0, Math.round((new Date(resetAt).getTime() - Date.now()) / 60000))
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${minutes}m`
}

function pillClass(issue) {
  if (issue.severity === 'critical') return 'summary-pill critical'
  if (issue.severity === 'warning') return 'summary-pill warning'
  return 'summary-pill'
}

function renderIssues() {
  const critical = state.issues.filter((issue) => issue.severity === 'critical').length
  const warning = state.issues.filter((issue) => issue.severity === 'warning').length
  const approval = state.issues.filter((issue) => issue.requiresApproval).length
  elements.criticalCount.textContent = String(critical)
  elements.warningCount.textContent = String(warning)
  elements.approvalCount.textContent = String(approval)

  if (state.issues.length === 0) {
    elements.issueList.innerHTML = '<div class="empty-state">No active Sentinel issues from the current DevTools signals.</div>'
    return
  }

  elements.issueList.innerHTML = ''
  for (const issue of state.issues) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'issue-card'
    button.innerHTML = `
      <div class="issue-meta">
        <span class="${pillClass(issue)}">${issue.severity}</span>
        <span class="summary-pill approval">${issue.requiresApproval ? 'approval' : 'safe'}</span>
      </div>
      <h3>${escapeHtml(issue.title)}</h3>
      <p>${escapeHtml(issue.diagnosis)}</p>
    `
    button.addEventListener('click', () => openIssue(issue.id))
    elements.issueList.appendChild(button)
  }
}

function fillSelect(select, values, selected) {
  select.innerHTML = ''
  for (const value of values) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value
    option.selected = value === selected
    select.appendChild(option)
  }
}

function openIssue(id) {
  const issue = state.issues.find((item) => item.id === id)
  if (!issue) return
  state.selectedIssue = issue
  elements.dialogSeverity.className = pillClass(issue)
  elements.dialogSeverity.textContent = issue.severity
  elements.dialogTitle.textContent = issue.title
  elements.dialogDiagnosis.textContent = issue.diagnosis
  elements.dialogEvidence.innerHTML = issue.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
  fillSelect(elements.agentSelect, agents, issue.assignedAgent)
  fillSelect(elements.providerSelect, providers, issue.assignedProvider)
  elements.issueDialog.showModal()
}

function updateDecision(status) {
  if (!state.selectedIssue) return
  state.decisions[state.selectedIssue.id] = {
    status,
    assignedAgent: elements.agentSelect.value,
    assignedProvider: elements.providerSelect.value,
    updatedAt: new Date().toISOString()
  }
  saveDecisions()
  elements.issueDialog.close()
  refresh()
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char])
}

function scheduleAutoRefresh() {
  window.clearInterval(state.timer)
  if (state.autoRefresh) state.timer = window.setInterval(refresh, 30000)
}

function init() {
  elements.baseUrlInput.value = state.baseUrl
  elements.autoRefreshToggle.checked = state.autoRefresh
  elements.saveUrlButton.addEventListener('click', () => {
    state.baseUrl = normalizeBaseUrl(elements.baseUrlInput.value) || window.location.origin
    localStorage.setItem('sentinel.baseUrl', state.baseUrl)
    refresh()
  })
  elements.refreshButton.addEventListener('click', refresh)
  elements.autoRefreshToggle.addEventListener('change', () => {
    state.autoRefresh = elements.autoRefreshToggle.checked
    localStorage.setItem('sentinel.autoRefresh', String(state.autoRefresh))
    scheduleAutoRefresh()
  })
  elements.closeDialogButton.addEventListener('click', () => elements.issueDialog.close())
  elements.approveButton.addEventListener('click', () => updateDecision('approved'))
  elements.dismissButton.addEventListener('click', () => updateDecision('dismissed'))
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {})
  refresh()
  scheduleAutoRefresh()
}

init()
