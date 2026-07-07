// Only file permitted to fetch the Deepgram API (enforced by the no-direct-deepgram ESLint rule).
// Production Deepgram Nova-3 integration (replaces the P01 stub).

export interface TranscriptionResult {
  text: string
  language: string
  duration_seconds: number
  confidence: number
  words: Array<{ word: string; start: number; end: number; confidence: number }>
}

export interface TranscribeOptions {
  language?: string
  model?: string
}

interface DeepgramListenResponse {
  results: {
    channels: Array<{
      alternatives: Array<{
        transcript: string
        confidence: number
        words: Array<{ word: string; start: number; end: number; confidence: number }>
      }>
    }>
    metadata: { duration: number }
  }
}

export const deepgramProvider = {
  /**
   * Transcribe an audio buffer with Deepgram. Returns the transcript plus
   * timing/confidence metadata. With LLM_STUB=true a canned Spanish transcript
   * is returned without any network call (dev + test).
   */
  async transcribe(
    audioBuffer: ArrayBuffer,
    mimeType: string,
    options: TranscribeOptions = {},
  ): Promise<TranscriptionResult> {
    const apiKey = process.env['DEEPGRAM_API_KEY']
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY not set')

    if (process.env['LLM_STUB'] === 'true') {
      return {
        text: 'Hola quiero una cita para la próxima semana.',
        language: 'es',
        duration_seconds: 3.2,
        confidence: 0.98,
        words: [],
      }
    }

    const model = options.model ?? 'nova-3'
    const language = options.language ?? 'es'

    const url = new URL('https://api.deepgram.com/v1/listen')
    url.searchParams.set('model', model)
    url.searchParams.set('language', language)
    url.searchParams.set('smart_format', 'true')
    url.searchParams.set('punctuate', 'true')
    url.searchParams.set('diarize', 'false')
    url.searchParams.set('utterances', 'false')

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': mimeType,
      },
      body: audioBuffer,
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Deepgram error ${response.status}: ${err}`)
    }

    const data = (await response.json()) as DeepgramListenResponse

    const alt = data.results?.channels[0]?.alternatives[0]
    if (!alt) throw new Error('Deepgram returned empty transcript')

    return {
      text: alt.transcript,
      language,
      duration_seconds: data.results.metadata?.duration ?? 0,
      confidence: alt.confidence,
      words: alt.words ?? [],
    }
  },
}

/**
 * Backwards-compatible factory. Validates the api key is present and returns the
 * shared {@link deepgramProvider}. Kept so existing call sites keep compiling.
 */
export function createDeepgramProvider(config: { apiKey: string }): typeof deepgramProvider {
  if (!config.apiKey) throw new Error('createDeepgramProvider: apiKey is required')
  return deepgramProvider
}
