/**
 * OCR / rich-format text extraction (Phase 3C). Provider-abstracted; the fake
 * returns supplied text so document-ingestion is testable without a real OCR API.
 * Real adapter (Google Vision / similar) is wired for swap-in.
 */
export interface OcrProvider {
  readonly name: string;
  extractText(bytes: ArrayBuffer, opts?: { mimeType?: string }): Promise<string>;
}

export class FakeOcrProvider implements OcrProvider {
  readonly name = "fake-ocr";
  constructor(private readonly canned = "") {}
  extractText(): Promise<string> {
    return Promise.resolve(this.canned);
  }
}

export interface GoogleVisionConfig {
  apiKey: string;
  baseUrl?: string;
}

export class GoogleVisionOcrProvider implements OcrProvider {
  readonly name = "google-vision";
  private readonly cfg: Required<GoogleVisionConfig>;
  constructor(cfg: GoogleVisionConfig) {
    this.cfg = { baseUrl: "https://vision.googleapis.com/v1", ...cfg };
  }
  async extractText(bytes: ArrayBuffer): Promise<string> {
    const content = Buffer.from(bytes).toString("base64");
    const res = await fetch(`${this.cfg.baseUrl}/images:annotate?key=${this.cfg.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: [{ image: { content }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }],
      }),
    });
    if (!res.ok) throw new Error(`Google Vision ${res.status}`);
    const json = (await res.json()) as {
      responses?: { fullTextAnnotation?: { text?: string } }[];
    };
    return json.responses?.[0]?.fullTextAnnotation?.text ?? "";
  }
}
