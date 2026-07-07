import fs from 'node:fs'
import dotenv from 'dotenv'
import { envExampleFile, envFile } from './paths.js'

export const requiredEnvVars = [
  'TOOLS_DB_URL',
  'TOOLS_DB_SERVICE_KEY',
  'MONOREPO_ROOT',
  'NEXT_PUBLIC_DASHBOARD_PORT',
  'WEBHOOK_TARGET',
  'DEV_LICENSE_SIGNING_KEY'
]

export const optionalEnvVars = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_MESSAGING_BOT_TOKEN',
  'DISCORD_CHANNEL_ID',
  'DISCORD_CRITICAL_CHANNEL_ID',
  'DISCORD_UPDATE_CHANNEL_ID',
  'DISCORD_APPROVAL_CHANNEL_ID',
  'DISCORD_STACK_CHANNEL_ID',
  'GATES_STRICT',
  'COST_ALERT_THRESHOLD_USD',
  'COST_DISPLAY_CURRENCY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_PATH',
  'OPENAI_API_KEY',
  'OPENAI_EMBEDDING_KEY',
  'GOOGLE_GEMINI_API_KEY',
  'MISTRAL_API_KEY',
  'CUSTOM_AI_API_KEY',
  'CUSTOM_AI_BASE_URL',
  'CUSTOM_AI_MODEL',
  'GROK_API_KEY',
  'GROK_BASE_URL',
  'GROK_MODEL',
  'STACK_NEWS_SOURCE',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'DEEPGRAM_API_KEY',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'META_APP_SECRET',
  'META_VERIFY_TOKEN',
  'WHATSAPP_DEFAULT_ACCESS_TOKEN',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'LICENSE_SERVER_URL',
  'LICENSE_PUBLIC_KEY',
  'GITHUB_TOKEN',
  'GITHUB_ORG',
  'APP_URL',
  'APP_VERSION',
  'API_PORT',
  'NODE_ENV',
  'LLM_STUB',
  'SERVER_ID',
  'VPS_HOST',
  'VPS_USER',
  'VPS_SSH_KEY_PATH',
  'VPS_DEPLOY_PATH',
  'VPS_DOMAIN',
  'ENV_PRODUCTION_PATH',
  'GITHUB_REPO',
  'GITHUB_BRANCH',
  'PM2_ECOSYSTEM_FILE',
  'NOTION_API_KEY',
  'NOTION_PROMPTS_DB_ID',
  'NOTION_BUILD_CONTROL_DB_ID',
  'NOTION_CLAUDE_MD_PAGE_ID'
]

export function loadConfig() {
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile })
  } else if (fs.existsSync(envExampleFile)) {
    dotenv.config({ path: envExampleFile })
  }
  return process.env
}

export function envStatus() {
  loadConfig()
  return {
    required: requiredEnvVars.map((name) => ({ name, present: Boolean(process.env[name]) })),
    optional: optionalEnvVars.map((name) => ({ name, present: Boolean(process.env[name]) }))
  }
}
