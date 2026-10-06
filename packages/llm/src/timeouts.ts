// The OpenAI/Anthropic SDKs default to a 10-minute timeout with 2 retries, so a
// stalled provider could hold a patient's reply (and the workflow job behind it)
// for ~30 minutes. Every chat call is bounded to one minute with a single retry.
export const LLM_TIMEOUT_MS = 60_000
export const LLM_MAX_RETRIES = 1
