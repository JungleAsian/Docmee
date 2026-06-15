import type { Env } from "@docmee/core";
import { gatewayFromKeys, type LlmGateway } from "@docmee/llm";
import type { OutboundTransport } from "@docmee/db";

/** Build the LLM gateway from env (real providers if X5 keys present, else fakes). */
export function buildGateway(env: Env): LlmGateway {
  return gatewayFromKeys({
    anthropic: env.ANTHROPIC_API_KEY,
    deepseek: env.DEEPSEEK_API_KEY,
    openai: env.OPENAI_API_KEY,
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
