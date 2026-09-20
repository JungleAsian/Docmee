import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { learningCopy, type LearningCandidate } from '@/shared/kbLearning'
import KbLearningPanel, { EvidenceView, SettingsForm } from './KbLearningPanel'

vi.stubGlobal('React', React)
describe('staff learning presentation', () => {
  it('renders only the selected clinic candidates even when another clinic is cached', () => {
    const client = new QueryClient()
    client.setQueryData(['kb-learning', 'clinic-a', 'candidates', 'pending_review'], [{ id: 'a', clinicId: 'clinic-a', candidateContent: 'Clinic A fact' }])
    client.setQueryData(['kb-learning', 'clinic-b', 'candidates', 'pending_review'], [{ id: 'b', clinicId: 'clinic-b', candidateContent: 'Clinic B private fact' }])
    const markup = renderToStaticMarkup(<QueryClientProvider client={client}><KbLearningPanel clinicId="clinic-a" documents={[]} /></QueryClientProvider>)
    expect(markup).toContain('Clinic A fact')
    expect(markup).not.toContain('Clinic B private fact')
    client.clear()
  })
  it('bounds candidate summaries and treats generated content as text', () => {
    const client = new QueryClient()
    const candidates = Array.from({ length: 51 }, (_, index) => ({ id: String(index), clinicId: 'clinic-a', candidateContent: index === 0 ? '<img onerror="alert(1)" />' : `Candidate-${index}-fact` })) as LearningCandidate[]
    client.setQueryData(['kb-learning', 'clinic-a', 'candidates', 'pending_review'], candidates)
    const markup = renderToStaticMarkup(<QueryClientProvider client={client}><KbLearningPanel clinicId="clinic-a" documents={[]} /></QueryClientProvider>)
    expect(markup).toContain('Candidate-49-fact')
    expect(markup).not.toContain('Candidate-50-fact')
    expect(markup).not.toContain('<img')
    expect(markup).toContain('&lt;img')
    client.clear()
  })
  it.each(['en', 'es'] as const)('keeps missing measures unknown and escapes evidence in %s', language => {
    const copy = learningCopy[language]
    const markup = renderToStaticMarkup(<EvidenceView copy={copy} evidence={{ relevance: .93, confidence: null, grounding: .4, contradiction: 'unknown', risks: ['<script>alert(1)</script>'] }} />)
    expect(markup).toContain('93%')
    expect(markup).toContain('40%')
    expect(markup).toContain(copy.unknown)
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('&lt;script&gt;')
  })
  it('does not enable automatic publication when server settings say off', () => {
    const client = new QueryClient()
    const markup = renderToStaticMarkup(<QueryClientProvider client={client}><SettingsForm value={{ autoApprove: false, groundingThreshold: 1, evidenceRetentionHours: 24 }} base="/clinics/clinic-a/kb/learning" copy={learningCopy.en} onSaved={() => {}} onError={() => {}} /></QueryClientProvider>)
    expect(markup).toContain('type="checkbox"')
    expect(markup).not.toContain('checked=""')
    expect(markup).toContain('min="1" max="24"')
    expect(markup).toContain('min="80" max="100"')
    client.clear()
  })
})
