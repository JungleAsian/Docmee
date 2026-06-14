import { describe, expect, it } from "vitest";
import { FakeTranscriptionProvider } from "./transcription.js";

describe("transcription provider", () => {
  it("fake returns canned text (swappable for Deepgram)", async () => {
    const p = new FakeTranscriptionProvider("hola");
    expect(await p.transcribe(new ArrayBuffer(0), { locale: "es" })).toBe("hola");
  });
});
