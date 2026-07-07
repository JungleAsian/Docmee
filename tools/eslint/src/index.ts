import noDirectSupabase from './rules/no-direct-supabase.js'
import noDirectBullmq from './rules/no-direct-bullmq.js'
import noDirectAnthropic from './rules/no-direct-anthropic.js'
import noDirectOpenai from './rules/no-direct-openai.js'
import noDirectDeepseek from './rules/no-direct-deepseek.js'
import noDirectResend from './rules/no-direct-resend.js'
import noDirectGoogleapis from './rules/no-direct-googleapis.js'
import noDirectDeepgram from './rules/no-direct-deepgram.js'

export default {
  rules: {
    'no-direct-supabase': noDirectSupabase,
    'no-direct-bullmq': noDirectBullmq,
    'no-direct-anthropic': noDirectAnthropic,
    'no-direct-openai': noDirectOpenai,
    'no-direct-deepseek': noDirectDeepseek,
    'no-direct-resend': noDirectResend,
    'no-direct-googleapis': noDirectGoogleapis,
    'no-direct-deepgram': noDirectDeepgram
  }
}
