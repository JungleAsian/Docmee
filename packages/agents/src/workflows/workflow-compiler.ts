import type { WorkflowDefinition, WorkflowDocument, WorkflowDocumentV2 } from '@docmee/db'

function isV2Document(document: WorkflowDocument): document is WorkflowDocumentV2 {
  return 'version' in document && document.version === 2
}

/**
 * Normalizes either supported workflow document shape for the existing runner.
 * V2 layout data never reaches the execution graph; V1 retains its coordinates
 * while legacy storage and clients continue to use that representation.
 */
export function compileWorkflowDocument(document: WorkflowDocument): WorkflowDefinition {
  if (!isV2Document(document)) return document
  return {
    nodes: document.definition.nodes.map((node) => ({ ...node, x: 0, y: 0 })),
    edges: document.definition.edges.map((edge) => ({ ...edge })),
  }
}

/**
 * Compatibility projection for the legacy `workflows.nodes`/`edges` columns.
 * The runner must use `compileWorkflowDocument`; this function exists only so
 * V1 clients can keep rendering a V2 document during the gradual migration.
 */
export function materializeWorkflowDocument(document: WorkflowDocument): WorkflowDefinition {
  if (!isV2Document(document)) return document
  return {
    nodes: document.definition.nodes.map((node) => {
      const position = document.presentation.nodes[node.id]
      return { ...node, x: position?.x ?? 0, y: position?.y ?? 0 }
    }),
    edges: document.definition.edges.map((edge) => ({ ...edge })),
  }
}
