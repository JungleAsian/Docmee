export type LlmRole = 'user' | 'assistant' | 'system'

export interface LlmMessage {
  role: LlmRole
  content: string
}

export interface LlmResponse {
  content: string
  model: string
  inputTokens: number
  outputTokens: number
}

export interface LlmProvider {
  complete(messages: LlmMessage[], options?: LlmOptions): Promise<LlmResponse>
}

export interface LlmOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
}

export * from './gateway.js'

export function createStubProvider(): LlmProvider {
  return {
    async complete(_messages) {
      return {
        content: '[LLM_STUB] Response placeholder — set LLM_STUB=false to use real provider',
        model: 'stub',
        inputTokens: 0,
        outputTokens: 0,
      }
    },
  }
}
