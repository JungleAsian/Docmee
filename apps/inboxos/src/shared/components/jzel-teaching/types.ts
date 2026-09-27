export interface Candidate {
  id: string; revision: number; status: string; candidateContent: string
  publishedDocumentId: string | null; publishedDocumentVersion: number | null; expiresAt: string | null
  originalSource: { title?: string }; evidence: { doctorId: string | null; language: 'en' | 'es' | null }
}
export interface Related { documentId: string; title: string; content: string; documentVersion: number }
export interface Proposal { candidate: Candidate; related: Related[]; previous: { title: string; content: string; version: number } | null }
export interface Status {
  candidate: Candidate; availability: string; indexingStatus: string | null
  history: { id: string; action: string; content: string; documentVersion: number | null; createdAt: string }[]
  related?: Related[]; previous?: Proposal['previous']
}
export interface TeachingOptions {
  clinic: { id: string; name: string }; doctors: { id: string; name: string }[]
  documents: { id: string; title: string; version: number; metadata: { doctorId?: string | null; language?: string | null } }[]
  documentsTruncated: boolean
  nodes: { workflowId: string; nodeId: string; name: string; version: number; status: string }[]
}
export interface Preview {
  action: string; reason: string | null; answer: string; sent: false; workflowVersion: number; workflowStatus: string
  sources: { documentId: string; title: string; documentVersion: number }[]
  diagnostics: ResponseDiagnostics
}
export interface ResponseDiagnostics {
  clinic: { id: string; name: string }
  workflowNode: { workflowId: string; workflowName: string; nodeId: string } | null
  kbMatches: number
  retrievalMode: 'embedded' | 'keyword' | 'none'
  sources: { documentId: string; title: string; documentVersion: number }[]
}
