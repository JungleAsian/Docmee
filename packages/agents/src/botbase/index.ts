export {
  isInsideBusinessHours,
  type BusinessHours,
  type DayHours,
} from './business-hours.js'

export { detectLanguage, type Language } from './language-detector.js'

export {
  searchKb,
  rankChunks,
  cosineSimilarity,
  type Embedder,
  type EmbeddedChunk,
  type KbMatch,
} from './kb-retriever.js'

export {
  detectDoctorId,
  scopeChunksToDoctor,
  scopeKbToMessage,
  hasDoctorScopedChunks,
  type DoctorRef,
  type DoctorScoped,
} from './doctor-kb.js'

export {
  screenMedicalSafety,
  medicalSafetyDeferral,
  type MedicalSafetyCategory,
  type MedicalSafetyResult,
} from './medical-safety.js'

export {
  runClinicBot,
  isEmergencyMessage,
  isLikelyQuestion,
  emergencyNotice,
  resolveLanguage,
  type BotTone,
  type BotLanguage,
  type ClinicBotConfig,
  type ClinicBotInput,
  type ClinicBotDeps,
  type ClinicBotResult,
  type BotErrorInfo,
} from './clinic-bot.js'

export {
  trainDocument,
  extractText,
  parseFaqPairs,
  looksLikeFaq,
  chunkText,
  detectFormat,
  needsOcr,
  type DocumentFormat,
  type TrainedChunk,
  type TrainDocumentInput,
  type QAPair,
} from './document-trainer.js'

export { ocrImage, type OcrResult } from './ocr.js'

export {
  matchCustomFlow,
  type CustomFlowDef,
  type CustomFlowAction,
  type CustomFlowLanguage,
} from './custom-flows.js'

export {
  startFlow,
  advanceFlow,
  toFlowDef,
  type FlowDef,
  type FlowStep,
  type FlowBranch,
  type FlowBranchOp,
  type FlowState,
  type FlowRunResult,
} from './flow-engine.js'

export {
  FLOW_TEMPLATES,
  findFlowTemplate,
  type FlowTemplate,
  type FlowTemplateKey,
} from './flow-templates.js'
