import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import Handlebars from 'handlebars'
import { log } from '../lib/logger.js'
import { templatesDir, toolsRoot } from '../lib/paths.js'

function renderTemplate(templateName: string, name: string) {
  const file = path.join(templatesDir, templateName)
  const template = Handlebars.compile(fs.readFileSync(file, 'utf8'))
  const tableName = name.replace(/-/g, '_').toLowerCase()
  return template({ name, pascalName: name.replace(/(^|-)(\w)/g, (_, __, char: string) => char.toUpperCase()), table_name: tableName })
}

function writeGenerated(kind: string, name: string, content: string) {
  const dir = path.join(toolsRoot, 'logs', 'generated', kind)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.${kind === 'migration' ? 'sql' : 'ts'}`), content)
  log('codegen', `Generated ${kind} ${name}`)
}

export const codegenCmd = new Command('codegen').description('Generate DevTools code from templates')

codegenCmd.option('--all', 'Generate sample artifacts').action((opts: { all?: boolean }) => {
  if (opts.all) {
    writeGenerated('repository', 'sample', renderTemplate('repository.ts.hbs', 'sample'))
    writeGenerated('route', 'sample', renderTemplate('route.ts.hbs', 'sample'))
    writeGenerated('worker', 'sample', renderTemplate('worker.ts.hbs', 'sample'))
    writeGenerated('migration', 'sample', renderTemplate('migration.sql.hbs', 'sample'))
  }
})

codegenCmd.command('repository').requiredOption('--name <name>').action((opts: { name: string }) => writeGenerated('repository', opts.name, renderTemplate('repository.ts.hbs', opts.name)))
codegenCmd.command('route').requiredOption('--name <name>').action((opts: { name: string }) => writeGenerated('route', opts.name, renderTemplate('route.ts.hbs', opts.name)))
codegenCmd.command('worker').requiredOption('--name <name>').action((opts: { name: string }) => writeGenerated('worker', opts.name, renderTemplate('worker.ts.hbs', opts.name)))
codegenCmd.command('migration').requiredOption('--name <name>').action((opts: { name: string }) => writeGenerated('migration', opts.name, renderTemplate('migration.sql.hbs', opts.name)))
