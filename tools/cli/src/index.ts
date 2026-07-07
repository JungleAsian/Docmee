#!/usr/bin/env node
import { program } from 'commander'
import { setupCmd } from './commands/setup.js'
import { backlogCmd } from './commands/backlog.js'
import { activityCmd } from './commands/activity.js'
import { journalCmd } from './commands/journal.js'
import { mockupCmd } from './commands/mockup.js'
import { uiWiringCmd } from './commands/ui-wiring.js'
import { migrateCmd } from './commands/migrate.js'
import { rlsCmd } from './commands/rls.js'
import { codegenCmd } from './commands/codegen.js'
import { dalCmd } from './commands/dal.js'
import { routeCmd } from './commands/route.js'
import { seedCmd } from './commands/seed.js'
import { envCmd } from './commands/env.js'
import { webhookCmd } from './commands/webhook.js'
import { gatesCmd } from './commands/gates.js'
import { phaseCmd } from './commands/phase.js'
import { costCmd } from './commands/cost.js'
import { prCmd } from './commands/pr.js'
import { licenseCmd } from './commands/license.js'
import { discordCmd } from './commands/discord.js'
import { deployCmd } from './commands/deploy.js'
import { acceptCmd } from './commands/accept.js'
import { diagnoseCmd } from './commands/diagnose.js'
import { agentsCmd } from './commands/agents.js'
import { stackCmd } from './commands/stack.js'
import { readyCmd } from './commands/ready.js'
import { featureCmd } from './commands/feature.js'
import { forgeCmd } from './commands/forge.js'
import { guardianCmd } from './commands/guardian.js'
import { aegisCmd } from './commands/aegis.js'
import { enhancementCmd } from './commands/enhancement.js'
import { designAuditCmd } from './commands/design-audit.js'
import { uiDevelopmentCmd } from './commands/ui-development.js'
import { designRunCmd } from './commands/design-run.js'
import { llmCmd } from './commands/llm.js'
import { devtoolsCmd } from './commands/devtools.js'

program.name('tool').description('Docmee DevTools CLI').version('2.0.0')
program.addCommand(setupCmd)
program.addCommand(backlogCmd)
program.addCommand(activityCmd)
program.addCommand(journalCmd)
program.addCommand(mockupCmd)
program.addCommand(uiWiringCmd)
program.addCommand(migrateCmd)
program.addCommand(rlsCmd)
program.addCommand(codegenCmd)
program.addCommand(dalCmd)
program.addCommand(routeCmd)
program.addCommand(seedCmd)
program.addCommand(envCmd)
program.addCommand(webhookCmd)
program.addCommand(gatesCmd)
program.addCommand(phaseCmd)
program.addCommand(costCmd)
program.addCommand(prCmd)
program.addCommand(licenseCmd)
program.addCommand(discordCmd)
program.addCommand(deployCmd)
program.addCommand(acceptCmd)
program.addCommand(diagnoseCmd)
program.addCommand(agentsCmd)
program.addCommand(stackCmd)
program.addCommand(readyCmd)
program.addCommand(featureCmd)
program.addCommand(forgeCmd)
program.addCommand(guardianCmd)
program.addCommand(aegisCmd)
program.addCommand(enhancementCmd)
program.addCommand(designAuditCmd)
program.addCommand(uiDevelopmentCmd)
program.addCommand(designRunCmd)
program.addCommand(llmCmd)
program.addCommand(devtoolsCmd)
program.parse()
