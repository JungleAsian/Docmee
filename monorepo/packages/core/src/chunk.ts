/**
 * Text chunking for document → KB ingestion (Phase 3C). Splits on paragraph/
 * sentence boundaries into ~maxChars windows so each chunk embeds well. Pure.
 */
export function chunkText(text: string, maxChars = 800): string[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const para of paras) {
    if (para.length > maxChars) {
      flush();
      // Split an oversized paragraph on sentence boundaries.
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if ((current + " " + s).trim().length > maxChars) flush();
        current = (current ? current + " " : "") + s;
      }
      flush();
    } else if ((current + "\n\n" + para).length > maxChars) {
      flush();
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  flush();
  return chunks;
}
