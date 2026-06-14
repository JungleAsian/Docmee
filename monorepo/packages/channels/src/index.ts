/**
 * @docmee/channels — channel adapters. OWNER: Prime.
 * Phase 0: Meta WhatsApp webhook (verify + signature + normalize) and the
 * Evolution interim adapter. Messenger/Instagram land in 2B; transcription in 1A.
 */
export {
  verifyChallenge,
  verifySignature,
  normalizeMeta,
  type VerifyChallengeParams,
} from "./webhook/meta.js";
export { normalizeEvolution } from "./webhook/evolution.js";
export {
  type TranscriptionProvider,
  FakeTranscriptionProvider,
  DeepgramTranscriptionProvider,
  type DeepgramConfig,
} from "./transcription.js";
