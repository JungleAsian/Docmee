'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { PillToggle } from '@/shared/components/PillToggle'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'

type ReviewState = 'trusted' | 'needs_review' | 'stale' | 'excluded' | 'archived'
type RiskTier = 'low' | 'medium' | 'high'

interface GovernanceRecord {
  id: string
  area: 'knowledge' | 'attributes' | 'schedule' | 'developer'
  key: string
  title: string
  description: string
  owner: string | null
  reviewState: ReviewState
  riskTier: RiskTier
  visibility: string
  lastReviewedAt: string | null
  lastTestedAt: string | null
  secretState: string | null
}

interface CustomAttribute {
  id: string
  key: string
  label: string
  source: string[]
  allowedEditor: string[]
  visibility: string
  lifecycle: string
  workflowUse: string[]
  sensitive: boolean
  aiCollectable: boolean
  active: boolean
}

interface KnowledgeSource {
  id: string
  title: string
  documentType: string
  status: string
  reviewState: ReviewState
  owner: string | null
  lastReviewedAt: string | null
  riskTier: RiskTier
}

interface ApiToken {
  id: string
  name: string
  purpose: string
  scopes: string[]
  tokenPrefix: string
  status: string
  createdBy: string | null
  createdAt: string
  revokedAt: string | null
}

interface WebhookRegistry {
  id: string
  endpointUrl: string
  owner: string
  purpose: string
  events: string[]
  secretState: string
  active: boolean
  lastTestedAt: string | null
  failureCount: number
}

interface GovernanceResponse {
  records: GovernanceRecord[]
  attributes: CustomAttribute[]
  knowledgeSources: KnowledgeSource[]
  tokens: ApiToken[]
  webhooks: WebhookRegistry[]
  scheduleWarnings: Array<{ code: string; severity: 'warning' | 'critical'; message: string }>
  readiness: {
    knowledgeStale: number
    excludedKnowledge: number
    customAttributes: number
    scheduleWarnings: number
    activeTokens: number
    activeWebhooks: number
  }
}

const REVIEW_OPTIONS: ReviewState[] = ['trusted', 'needs_review', 'stale', 'excluded', 'archived']

export default function GovernancePage() {
  const { clinicId, switchClinic } = useActiveClinic()
  const qc = useQueryClient()
  const [tokenName, setTokenName] = useState('')
  const [tokenPurpose, setTokenPurpose] = useState('')
  const [newToken, setNewToken] = useState<string | null>(null)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookOwner, setWebhookOwner] = useState('')
  const [webhookPurpose, setWebhookPurpose] = useState('')

  const query = useQuery({
    queryKey: ['governance', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<GovernanceResponse>(`/clinics/${clinicId}/governance`),
  })
  const data = query.data
  const invalidate = () => qc.invalidateQueries({ queryKey: ['governance', clinicId] })

  const updateRecord = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<GovernanceRecord> }) =>
      api.patch(`/clinics/${clinicId}/governance/${id}`, body),
    onSuccess: invalidate,
  })
  const updateKnowledge = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { reviewState?: ReviewState; lastReviewedAt?: string; riskTier?: RiskTier } }) =>
      api.patch(`/clinics/${clinicId}/kb/${id}/governance`, body),
    onSuccess: invalidate,
  })
  const updateAttribute = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/clinics/${clinicId}/custom-attributes/${id}`, { active }),
    onSuccess: invalidate,
  })
  const createToken = useMutation({
    mutationFn: () => api.post<{ token: string }>(`/clinics/${clinicId}/api-tokens`, {
      name: tokenName,
      purpose: tokenPurpose,
      scopes: ['read:clinic', 'write:webhook'],
    }),
    onSuccess: (result) => {
      setNewToken(result.token)
      setTokenName('')
      setTokenPurpose('')
      invalidate()
    },
  })
  const revokeToken = useMutation({
    mutationFn: (id: string) => api.del(`/clinics/${clinicId}/api-tokens/${id}`),
    onSuccess: invalidate,
  })
  const createWebhook = useMutation({
    mutationFn: () => api.post(`/clinics/${clinicId}/webhook-registry`, {
      endpointUrl: webhookUrl,
      owner: webhookOwner,
      purpose: webhookPurpose,
      events: ['message.created'],
      secretState: 'missing',
      active: true,
    }),
    onSuccess: () => {
      setWebhookUrl('')
      setWebhookOwner('')
      setWebhookPurpose('')
      invalidate()
    },
  })
  const testWebhook = useMutation({
    mutationFn: (id: string) => api.post(`/clinics/${clinicId}/webhook-registry/${id}/test`),
    onSuccess: invalidate,
  })

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-teal-600">Configuration governance</p>
          <h1 className="text-xl font-bold tracking-tight">Clinic readiness and audit controls</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            Review the clinic items that affect daily operations: knowledge freshness, intake fields, schedule warnings, and managed app connections.
          </p>
        </div>
        <ClinicSelect value={clinicId} onChange={switchClinic} label="Clinic" />
      </div>

      {!clinicId ? (
        <Empty text="Select a clinic to review governance readiness." />
      ) : query.isLoading ? (
        <Empty text="Loading governance controls..." />
      ) : query.isError || !data ? (
        <Empty text="Could not load governance controls." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Kpi label="Sources needing review" value={String(data.readiness.knowledgeStale)} tone="amber" />
            <Kpi label="Excluded sources" value={String(data.readiness.excludedKnowledge)} tone="gray" />
            <Kpi label="Attributes" value={String(data.readiness.customAttributes)} tone="indigo" />
            <Kpi label="Schedule warnings" value={String(data.readiness.scheduleWarnings)} tone={data.readiness.scheduleWarnings ? 'red' : 'emerald'} />
            <Kpi label="Secure app keys" value={String(data.readiness.activeTokens)} tone="cyan" />
            <Kpi label="Outside connections" value={String(data.readiness.activeWebhooks)} tone="violet" />
          </div>

          <Section title="Governance areas">
            <div className="grid gap-3">
              {data.records.map((record) => (
                <div key={record.id} className="clinic-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{record.title}</p>
                      <p className="mt-1 text-xs text-gray-500">{record.description}</p>
                    </div>
                    <Badge tone={record.riskTier === 'high' ? 'red' : record.riskTier === 'medium' ? 'amber' : 'emerald'}>
                      {record.riskTier}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      value={record.reviewState}
                      onChange={(e) => updateRecord.mutate({ id: record.id, body: { reviewState: e.target.value as ReviewState, lastReviewedAt: new Date().toISOString() } })}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                    >
                      {REVIEW_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                    <span className="text-xs text-gray-400">{record.visibility}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="AI training source freshness">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-gray-400">
                  <tr><th className="py-2">Source</th><th>Type</th><th>Risk</th><th>Review</th><th>Status</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.knowledgeSources.map((source) => (
                    <tr key={source.id}>
                      <td className="py-2 font-medium">{source.title}</td>
                      <td>{source.documentType}</td>
                      <td>{source.riskTier}</td>
                      <td>
                        <select
                          value={source.reviewState}
                          onChange={(e) => updateKnowledge.mutate({ id: source.id, body: { reviewState: e.target.value as ReviewState, lastReviewedAt: new Date().toISOString() } })}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                        >
                          {REVIEW_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </td>
                      <td><Badge tone={source.status === 'active' ? 'emerald' : 'gray'}>{source.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Clinic custom attributes">
            <div className="grid gap-3">
              {data.attributes.map((attr) => (
                <div key={attr.id} className="clinic-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{attr.label}</p>
                      <p className="font-mono text-xs text-gray-400">{attr.key}</p>
                    </div>
                    <PillToggle
                      checked={attr.active}
                      label={`${attr.label} active`}
                      size="sm"
                      onChange={(active) => updateAttribute.mutate({ id: attr.id, active })}
                    />
                  </div>
                  <p className="mt-2 text-xs text-gray-500">{attr.lifecycle}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {attr.workflowUse.map((use) => <Badge key={use} tone="indigo">{use}</Badge>)}
                    {attr.sensitive && <Badge tone="red">sensitive</Badge>}
                    {attr.aiCollectable && <Badge tone="cyan">AI collectable</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Schedule consistency">
            {data.scheduleWarnings.length === 0 ? (
              <Empty text="No schedule consistency warnings detected." compact />
            ) : (
              <ul className="space-y-2">
                {data.scheduleWarnings.map((warning) => (
                  <li key={`${warning.code}-${warning.message}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <b>{warning.severity}</b> - {warning.message}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <details className="clinic-card p-4">
            <summary className="cursor-pointer text-sm font-semibold text-gray-900 dark:text-gray-100">
              Advanced app connections
            </summary>
            <p className="mt-1 text-xs text-gray-500">
              No-code controls for trusted app keys and outbound system connections. Secret values are masked after creation.
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 mt-4 text-sm font-semibold">Secure app keys</h3>
                {newToken && (
                  <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                    <p className="font-semibold">New key created. Save it in the receiving app now.</p>
                    <p className="mt-1 break-all rounded-md bg-white/70 p-2 font-mono dark:bg-black/20">{newToken}</p>
                    <p className="mt-1">After you leave this page, Docmee will only show it as ********.</p>
                  </div>
                )}
                <div className="mb-3 grid gap-2">
                  <input value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder="Connection name" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
                  <input value={tokenPurpose} onChange={(e) => setTokenPurpose(e.target.value)} placeholder="What is this for?" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
                  <button disabled={!tokenName || !tokenPurpose || createToken.isPending} onClick={() => createToken.mutate()} className="rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Create secure key</button>
                </div>
                <ul className="space-y-2">
                  {data.tokens.map((token) => (
                    <li key={token.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                      <div><p className="text-sm font-medium">{token.name}</p><p className="text-xs text-gray-400">Key ********{token.tokenPrefix.slice(-4)} - {token.status}</p></div>
                      {token.status === 'active' && <button onClick={() => revokeToken.mutate(token.id)} className="text-xs font-semibold text-red-600">Revoke</button>}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 mt-4 text-sm font-semibold">Send updates to another system</h3>
                <div className="mb-3 grid gap-2">
                  <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="Receiving system URL" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
                  <input value={webhookOwner} onChange={(e) => setWebhookOwner(e.target.value)} placeholder="Who owns it?" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
                  <input value={webhookPurpose} onChange={(e) => setWebhookPurpose(e.target.value)} placeholder="What updates should it receive?" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
                  <button disabled={!webhookUrl || !webhookOwner || !webhookPurpose || createWebhook.isPending} onClick={() => createWebhook.mutate()} className="rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Add connection</button>
                </div>
                <ul className="space-y-2">
                  {data.webhooks.map((webhook) => (
                    <li key={webhook.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="break-all text-sm font-medium">{webhook.endpointUrl}</p><p className="text-xs text-gray-400">{webhook.owner} - secret {webhook.secretState === 'present' ? '********' : webhook.secretState}</p></div>
                        <button onClick={() => testWebhook.mutate(webhook.id)} className="text-xs font-semibold text-teal-600">Mark tested</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="clinic-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: 'amber' | 'gray' | 'indigo' | 'red' | 'emerald' | 'cyan' | 'violet' }) {
  const colors = {
    amber: 'text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300',
    gray: 'text-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-300',
    indigo: 'text-teal-700 bg-teal-50 dark:bg-teal-950/40 dark:text-teal-300',
    red: 'text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-300',
    emerald: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300',
    cyan: 'text-cyan-700 bg-cyan-50 dark:bg-cyan-950/40 dark:text-cyan-300',
    violet: 'text-cyan-700 bg-cyan-50 dark:bg-cyan-950/40 dark:text-cyan-300',
  }
  return (
    <div className={`clinic-card p-4 ${colors[tone]}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  )
}

function Badge({ tone, children }: { tone: 'red' | 'amber' | 'emerald' | 'gray' | 'indigo' | 'cyan'; children: ReactNode }) {
  const colors = {
    red: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
    indigo: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
    cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
  }
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${colors[tone]}`}>{children}</span>
}

function Empty({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-dashed border-gray-300 bg-white text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 ${compact ? 'p-4' : 'p-8'}`}>
      {text}
    </div>
  )
}
