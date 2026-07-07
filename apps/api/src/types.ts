export interface Env {
  NODE_ENV: 'development' | 'production' | 'test'
  API_PORT: number
  APP_URL: string
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  REDIS_URL: string
  LLM_STUB: boolean
  WEBHOOK_TARGET: string
  JWT_SECRET: string
  JWT_REFRESH_SECRET: string
}
