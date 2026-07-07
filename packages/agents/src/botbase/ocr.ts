// P25 (Req 25): OCR for scanned / photographed documents.
//
// Only this file loads the OCR engine. It mirrors the Deepgram provider pattern
// (packages/channels transcription): with LLM_STUB the canned text is returned with
// NO engine load, so dev + tests + the headless gate stay fully offline; the real
// path lazily imports tesseract.js so merely importing the document-trainer barrel
// never pulls in the heavy WASM engine.
//
// tesseract.js is intentionally NOT a package dependency (it would drift the
// lockfile and is only ever needed on the real LLM_STUB=false path): deployments
// that want live OCR run `pnpm add tesseract.js`. If it is absent, the lazy import
// rejects and the upload route surfaces a clean 422 — image uploads degrade, the
// process never crashes.

export interface OcrResult {
  text: string
  /** 0..1 confidence reported by the engine. */
  confidence: number
}

// Minimal shape of the optional engine. The module specifier is held in a variable
// below so TypeScript never tries to resolve `tesseract.js` at compile time — that
// keeps typecheck green across every package whether or not the engine is installed
// (a standalone .d.ts is not pulled into a consumer's program, and `declare module`
// inside a module file is an augmentation that needs the real module to exist).
interface TesseractEngine {
  createWorker(langs?: string): Promise<{
    recognize(image: Buffer): Promise<{ data: { text: string; confidence: number } }>
    terminate(): Promise<void>
  }>
}

/**
 * A document image (PNG/JPG/scan/photo) carrying text that no text layer exposes —
 * recognise the text with OCR.
 *
 * With LLM_STUB unset/true (default) a deterministic Spanish sample is returned and
 * the engine is never loaded. With LLM_STUB=false the real tesseract.js engine runs
 * (language from OCR_LANG, default `spa+eng` to cover the bilingual ES/EN clinics).
 */
export async function ocrImage(buffer: Buffer): Promise<OcrResult> {
  if (process.env['LLM_STUB'] !== 'false') {
    return {
      text: 'Horario de atención: lunes a viernes de 9 a 18h.\nConsulta general 250 GTQ.',
      confidence: 0.9,
    }
  }
  if (buffer.length === 0) return { text: '', confidence: 0 }

  const lang = process.env['OCR_LANG'] ?? 'spa+eng'
  const engineName = 'tesseract.js'
  const engine = (await import(engineName)) as unknown as TesseractEngine
  const worker = await engine.createWorker(lang)
  try {
    const { data } = await worker.recognize(buffer)
    return { text: data.text ?? '', confidence: (data.confidence ?? 0) / 100 }
  } finally {
    await worker.terminate()
  }
}
