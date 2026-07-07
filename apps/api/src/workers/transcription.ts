export interface TranscriptionJob {
  messageId: string
  audioUrl: string
  clinicId: string
}

export interface TranscriptionResult {
  messageId: string
  text: string
  confidence: number
}

export async function processTranscription(
  _job: TranscriptionJob,
): Promise<TranscriptionResult> {
  throw new Error('TranscriptionWorker: not implemented — wire packages/channels deepgram provider in P05+')
}
