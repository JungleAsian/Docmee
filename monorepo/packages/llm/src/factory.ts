import { LlmGateway } from "./gateway.js";
import {
  FakeChatProvider,
  FakeIntentProvider,
  FakeEmbeddingProvider,
} from "./providers/fake.js";
import {
  ClaudeChatProvider,
  DeepSeekIntentProvider,
  OpenAiEmbeddingProvider,
} from "./providers/real.js";

export interface ProviderKeys {
  anthropic?: string;
  deepseek?: string;
  openai?: string;
}

/**
 * Build the gateway from provider keys (X5). With all three present it wires the
 * real Claude/DeepSeek/OpenAI providers; otherwise deterministic fakes so the
 * pipeline runs end-to-end without keys. Shared by the API and the worker.
 */
export function gatewayFromKeys(keys: ProviderKeys): LlmGateway {
  if (keys.anthropic && keys.deepseek && keys.openai) {
    return new LlmGateway({
      chat: new ClaudeChatProvider({ apiKey: keys.anthropic }),
      intent: new DeepSeekIntentProvider({ apiKey: keys.deepseek }),
      embeddings: new OpenAiEmbeddingProvider({ apiKey: keys.openai }),
    });
  }
  return new LlmGateway({
    chat: new FakeChatProvider(),
    intent: new FakeIntentProvider(),
    embeddings: new FakeEmbeddingProvider(),
  });
}
