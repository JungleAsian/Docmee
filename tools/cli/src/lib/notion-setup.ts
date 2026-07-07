import { Client } from '@notionhq/client'
import { log } from './logger.js'
import { phaseDefinitions } from './phases.js'

const DEVELOPMENT_TOOLS_PAGE_ID = '38141c470daf8130b7d8dcd70fbb792a'

type DatabaseIds = {
  promptsDbId: string
  buildControlDbId: string
}

export async function createNotionDatabases(apiKey: string): Promise<DatabaseIds> {
  const notion = new Client({ auth: apiKey })
  const promptsDbId = await createPhasePromptsDb(notion)
  const buildControlDbId = await createBuildControlDb(notion)
  return { promptsDbId, buildControlDbId }
}

async function createPhasePromptsDb(notion: Client) {
  const existing = await findExistingDb(notion, 'Phase Prompts')
  if (existing) {
    log('setup', `Phase Prompts DB already exists: ${existing}`)
    return existing
  }
  try {
    await notion.pages.retrieve({ page_id: '38241c470daf81a8b44ef53543e6bb45' })
    log('setup', 'Known Phase Prompts page exists, but it is not a database. Creating database for setup automation.', 'warn')
  } catch {
    // Continue and create the database below.
  }

  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: DEVELOPMENT_TOOLS_PAGE_ID },
    title: [{ type: 'text', text: { content: 'Phase Prompts' } }],
    properties: {
      'Phase Name': { title: {} },
      'Phase ID': { rich_text: {} },
      Builder: { select: { options: [{ name: 'codex', color: 'blue' }, { name: 'claude-code', color: 'purple' }] } },
      'Business Phase': { select: { options: [{ name: '1', color: 'green' }, { name: '2', color: 'yellow' }, { name: '3', color: 'orange' }] } },
      Status: { select: { options: [{ name: 'draft', color: 'gray' }, { name: 'ready', color: 'green' }, { name: 'locked', color: 'blue' }] } },
      'Last Synced': { date: {} }
    }
  })
  await seedPhasePromptEntries(notion, db.id)
  log('setup', `Created Phase Prompts DB: ${db.id}`)
  return db.id
}

async function createBuildControlDb(notion: Client) {
  const existing = await findExistingDb(notion, 'Build Control')
  if (existing) {
    log('setup', `Build Control DB already exists: ${existing}`)
    return existing
  }

  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: DEVELOPMENT_TOOLS_PAGE_ID },
    title: [{ type: 'text', text: { content: 'Build Control' } }],
    properties: {
      'Phase Name': { title: {} },
      'Phase ID': { rich_text: {} },
      Builder: { select: { options: [{ name: 'codex', color: 'blue' }, { name: 'codex-pro', color: 'blue' }, { name: 'claude-code', color: 'purple' }] } },
      Status: {
        select: {
          options: [
            { name: 'pending', color: 'gray' },
            { name: 'awaiting-output', color: 'yellow' },
            { name: 'in-progress', color: 'blue' },
            { name: 'output-copied', color: 'orange' },
            { name: 'gates-running', color: 'purple' },
            { name: 'pushing', color: 'pink' },
            { name: 'complete', color: 'green' },
            { name: 'failed', color: 'red' }
          ]
        }
      },
      'Prompt Link': { url: {} },
      'Started At': { date: {} },
      'Completed At': { date: {} },
      'Commit Hash': { rich_text: {} },
      Notes: { rich_text: {} }
    }
  })
  await seedBuildControlEntries(notion, db.id)
  log('setup', `Created Build Control DB: ${db.id}`)
  return db.id
}

async function seedPhasePromptEntries(notion: Client, dbId: string) {
  for (const phase of phaseDefinitions) {
    await notion.pages.create({
      parent: { type: 'database_id', database_id: dbId },
      properties: {
        'Phase Name': { title: [{ text: { content: phase.name } }] },
        'Phase ID': { rich_text: [{ text: { content: phase.id } }] },
        Builder: { select: { name: phase.builder } },
        'Business Phase': { select: { name: String(phase.businessPhase) } },
        Status: { select: { name: phase.promptStatus } }
      }
    })
  }
  log('setup', `Seeded ${phaseDefinitions.length} Phase Prompt entries`)
}

async function seedBuildControlEntries(notion: Client, dbId: string) {
  for (const phase of phaseDefinitions) {
    await notion.pages.create({
      parent: { type: 'database_id', database_id: dbId },
      properties: {
        'Phase Name': { title: [{ text: { content: phase.name } }] },
        'Phase ID': { rich_text: [{ text: { content: phase.id } }] },
        Builder: { select: { name: phase.builder } },
        Status: { select: { name: 'pending' } }
      }
    })
  }
  log('setup', `Seeded ${phaseDefinitions.length} Build Control entries`)
}

async function findExistingDb(notion: Client, titleContains: string) {
  try {
    const { results } = await notion.search({
      query: titleContains,
      filter: { property: 'object', value: 'database' }
    })
    const match = results.find((result) => {
      if (result.object !== 'database') return false
      const title = 'title' in result && Array.isArray(result.title) ? result.title : []
      return title.some((item) => item.plain_text.includes(titleContains))
    })
    return match?.id ?? null
  } catch {
    return null
  }
}
