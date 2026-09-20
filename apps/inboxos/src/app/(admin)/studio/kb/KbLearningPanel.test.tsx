import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { learningCopy, reviewCommand, type LearningCandidate } from '@/shared/kbLearning'
import { captureReviewSession } from '@/shared/api/reviewSession'
import KbLearningPanel, { CandidateEvidenceView, EvidenceView, ReviewerReadinessChecklist, SettingsForm } from './KbLearningPanel'

vi.stubGlobal('React', React)
describe('staff learning presentation', () => {
  it('shows renewed validation after a grounded candidate is edited and reopened', () => {
    const original = { id: 'candidate-a', clinicId: 'clinic-a', revision: 1, expiresAt: '2099-01-01T00:00:00Z', candidateContent: 'Office opens at 8', humanEdit: null, status: 'pending_review', confidenceScore: 1, groundingScore: 1, contradictionFree: true, medicalSafetyOk: true, promptSafetyOk: true, evidence: { relevance: 1, confidence: 1, grounding: 1, contradiction: 'clear', risks: [] } } as unknown as LearningCandidate
    const before = renderToStaticMarkup(<CandidateEvidenceView candidate={original} content={original.candidateContent} copy={learningCopy.en} />)
    expect(before).not.toContain(learningCopy.en.revalidation)
    const edit = reviewCommand('clinic-a', original, 'edit', 'Office opens at 9', false)
    expect(edit).toMatchObject({ action: 'edit', expectedRevision: 1, content: 'Office opens at 9', staffConfirmed: false })
    // The authoritative save contract retains original evidence, but resets the
    // candidate's validation. This fixture models the refetched persisted row.
    const reopened = { ...original, revision: 2, humanEdit: edit.content!, groundingScore: 0, contradictionFree: false }
    const after = renderToStaticMarkup(<CandidateEvidenceView candidate={reopened} content={reopened.humanEdit} copy={learningCopy.en} />)
    expect(after).toContain(learningCopy.en.revalidation)
    expect(after).toContain(learningCopy.en.historicalEvidence)
    expect(after).toContain('0%')
    expect(after).toContain(learningCopy.en.unknown)
    expect(after.indexOf(learningCopy.en.medical)).toBeGreaterThan(after.indexOf(learningCopy.en.historicalEvidence))
  })
  it('renders only the selected clinic candidates even when another clinic is cached', () => {
    const client = new QueryClient()
    const generation = captureReviewSession('clinic-a').generation
    client.setQueryData(['kb-learning', 'clinic-a', generation, 'candidates', 'pending_review'], [{ id: 'a', clinicId: 'clinic-a', candidateContent: 'Clinic A fact' }])
    client.setQueryData(['kb-learning', 'clinic-b', generation, 'candidates', 'pending_review'], [{ id: 'b', clinicId: 'clinic-b', candidateContent: 'Clinic B private fact' }])
    client.setQueryData(['kb-learning', 'clinic-a', generation - 1, 'candidates', 'pending_review'], [{ id: 'old', clinicId: 'clinic-a', candidateContent: 'Prior session private fact' }])
    const markup = renderToStaticMarkup(<QueryClientProvider client={client}><KbLearningPanel clinicId="clinic-a" documents={[]} /></QueryClientProvider>)
    expect(markup).toContain('Clinic A fact')
    expect(markup).not.toContain('Clinic B private fact')
    expect(markup).not.toContain('Prior session private fact')
    client.clear()
  })
  it('bounds candidate summaries and treats generated content as text', () => {
    const client = new QueryClient()
    const candidates = Array.from({ length: 51 }, (_, index) => ({ id: String(index), clinicId: 'clinic-a', candidateContent: index === 0 ? '<img onerror="alert(1)" />' : `Candidate-${index}-fact` })) as LearningCandidate[]
    client.setQueryData(['kb-learning', 'clinic-a', captureReviewSession('clinic-a').generation, 'candidates', 'pending_review'], candidates)
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
    const markup = renderToStaticMarkup(<QueryClientProvider client={client}><SettingsForm session={captureReviewSession('clinic-a')} value={{ autoApprove: false, groundingThreshold: 1, evidenceRetentionHours: 24 }} base="/clinics/clinic-a/kb/learning" copy={learningCopy.en} onSaved={() => {}} onError={() => {}} /></QueryClientProvider>)
    expect(markup).toContain('type="checkbox"')
    expect(markup).not.toContain('checked=""')
    expect(markup).toContain('min="1" max="24"')
    expect(markup).toContain('min="80" max="100"')
    client.clear()
  })
  it('separates reviewer readiness from automatic approval eligibility', () => {
    const candidate = { id: 'candidate-a', clinicId: 'clinic-a', revision: 1, status: 'pending_review', expiresAt: '2099-01-01T00:00:00Z', automaticApprovalEligible: false,
      automaticApprovalReasons: ['repeat_consistency_required'], reviewReadiness: { citationsCurrent: true, confidenceAtLeast80: true, groundingMeetsThreshold: true, safetyClear: true, scopeClear: true, feedbackClear: true, unexpired: true, ready: true, reasons: [] } } as unknown as LearningCandidate
    const markup = renderToStaticMarkup(<ReviewerReadinessChecklist candidate={candidate} copy={learningCopy.en} />)
    expect(markup).toContain(learningCopy.en.readyForStaffApproval)
    expect(markup).toContain(learningCopy.en.notEligibleForAutomaticApproval)
    expect(markup).toContain(learningCopy.en.readinessCitations)
    expect(markup).toContain('repeat_consistency_required')
  })
})
