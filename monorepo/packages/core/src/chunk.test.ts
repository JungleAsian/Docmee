import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk.js";

describe("chunkText", () => {
  it("keeps small docs as one chunk", () => {
    expect(chunkText("Hola mundo.")).toEqual(["Hola mundo."]);
  });

  it("splits on paragraph boundaries within the budget", () => {
    const text = `${"a".repeat(500)}\n\n${"b".repeat(500)}`;
    const chunks = chunkText(text, 600);
    expect(chunks.length).toBe(2);
  });

  it("splits an oversized paragraph on sentences", () => {
    const text = "Uno. Dos. Tres. Cuatro. Cinco.";
    const chunks = chunkText(text, 12);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ")).toContain("Cinco.");
  });
});
