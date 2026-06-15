/**
 * Swappable transcription (architecture §15: Deepgram Nova-3). Abstracted so audio
 * handling never calls a provider directly and the provider can be swapped without
 * touching the pipeline. SEC06: audio is patient PHI — minimize/retain per policy.
 */
export interface TranscriptionProvider {
  readonly name: string;
  /** Transcribe audio bytes to text. `locale` hints the language (es/en). */
  transcribe(audio: ArrayBuffer, opts?: { locale?: string }): Promise<string>;
}

/** Deterministic fake for tests/dev (no Deepgram key needed). */
export class FakeTranscriptionProvider implements TranscriptionProvider {
  readonly name = "fake-transcription";
  constructor(private readonly canned = "[fake transcription]") {}
  async transcribe(_audio: ArrayBuffer, _opts?: { locale?: string }): Promise<string> {
    return Promise.resolve(this.canned);
  }
}

export interface DeepgramConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

/** Real Deepgram adapter (fetch-based; wired, activated when X5 key present). */
export class DeepgramTranscriptionProvider implements TranscriptionProvider {
  readonly name = "deepgram";
  private readonly cfg: Required<DeepgramConfig>;
  constructor(cfg: DeepgramConfig) {
    this.cfg = { model: "nova-3", baseUrl: "https://api.deepgram.com", ...cfg };
  }
  async transcribe(audio: ArrayBuffer, opts?: { locale?: string }): Promise<string> {
    const lang = opts?.locale === "en" ? "en" : "es";
    const res = await fetch(
      `${this.cfg.baseUrl}/v1/listen?model=${this.cfg.model}&language=${lang}`,
      {
        method: "POST",
        headers: {
          authorization: `Token ${this.cfg.apiKey}`,
          "content-type": "application/octet-stream",
        },
        body: audio,
      },
    );
    if (!res.ok) throw new Error(`Deepgram API ${res.status}`);
    const json = (await res.json()) as {
      results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
    };
    return json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  }
}
