// Usage: pnpm exec tsx scripts/prepare-daniel-booking-repair.ts original.json repaired.json
// Reads a Studio export and creates a NEW offline import file. No API or database writes.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseWorkflowExport, serializeWorkflowExport } from '../apps/inboxos/src/shared/workflowImport.js'
import { repairDanielBookingWorkflow } from '../apps/inboxos/src/shared/workflowBookingRepair.js'
import { validateWorkflowDefinition } from '../packages/agents/src/workflows/workflow-validator.js'

const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath) throw new Error('Provide the original Studio export path and a new output path')
const parsed = parseWorkflowExport(readFileSync(inputPath, 'utf8'))
if (!parsed.ok) throw new Error(parsed.error)
const repaired = repairDanielBookingWorkflow({ docmeeWorkflowExport: 1, name: parsed.name, nodes: parsed.nodes, edges: parsed.edges })
const errors = validateWorkflowDefinition(repaired.nodes, repaired.edges, { requireTrigger: true })
if (errors.length) throw new Error(`Repaired graph requires review:\n${errors.join('\n')}`)
writeFileSync(outputPath, serializeWorkflowExport(repaired.name, repaired.nodes, repaired.edges), { flag: 'wx' })
console.log('Created validated offline repair. The original export and live workflow are unchanged.')
