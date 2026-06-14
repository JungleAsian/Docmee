import type { Env } from "@docmee/core";
import {
  LlmGateway,
  FakeChatProvider,
  FakeIntentProvider,
  FakeEmbeddingProvider,
  ClaudeChatProvider,
  DeepSeekIntentProvider,
  OpenAiEmbeddingProvider,
} from "@docmee/llm";
import type { OutboundTransport } from "@docmee/db";

/**
 * Build the LLM gateway from env. With all X5 keys present it wires the real
 * Claude/DeepSeek/OpenAI providers; otherwise it falls back to deterministic
 * fakes so the pipeline runs end-to-end locally without keys.
 */
export function buildGateway(env: Env): LlmGateway {
  const haveKeys = env.ANTHROPIC_API_KEY && env.DEEPSEEK_API_KEY && env.OPENAI_API_KEY;
  if (haveKeys) {
    return new LlmGateway({
      chat: new ClaudeChatProvider({ apiKey: env.ANTHROPIC_API_KEY! }),
      intent: new DeepSeekIntentProvider({ apiKey: env.DEEPSEEK_API_KEY! }),
      embeddings: new OpenAiEmbeddingProvider({ apiKey: env.OPENAI_API_KEY! }),
    });
  }
  return new LlmGateway({
    chat: new FakeChatProvider(),
    intent: new FakeIntentProvider(),
    embeddings: new FakeEmbeddingProvider(),
  });
}

/**
 * Placeholder outbound transport until per-clinic Meta/Evolution senders land
 * (X10). It records intent without delivering — the chokepoint/suppression in
 * sendOutbound still runs, and messages are persisted. Replace with the real
 * channel sender when connectivity is provisioned.
 */
export function createLogTransport(
  log: (msg: string) => void,
): OutboundTransport {
  return {
     
    send: async ({ clinicId }) => {
      log(`outbound (no transport configured) for clinic ${clinicId}`);
      return {};
    },
  };
}
