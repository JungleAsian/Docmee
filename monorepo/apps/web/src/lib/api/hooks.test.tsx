import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createWrapper } from "../../test/react";
import { useSetConversationMode } from "./conversations";
import { useCreateKbEntry, useKbEntries } from "./kb";
import { usePatients } from "./patients";

describe("KB hooks", () => {
  it("lists seeded KB entries", async () => {
    const { result } = renderHook(() => useKbEntries(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.length).toBeGreaterThanOrEqual(2);
    expect(result.current.data?.some((e) => e.title === "Horario de atención")).toBe(true);
  });

  it("creates a KB entry", async () => {
    const { result } = renderHook(() => useCreateKbEntry(), { wrapper: createWrapper() });
    const created = await result.current.mutateAsync({ type: "rule", title: "Nueva regla", content: "X" });
    expect(created.id).toBeTruthy();
    expect(created.type).toBe("rule");
  });
});

describe("patient identity search", () => {
  it("filters by query", async () => {
    const { result } = renderHook(() => usePatients("Carlos"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.length).toBe(1);
    expect(result.current.data?.[0]?.name).toContain("Carlos");
  });
});

describe("conversation mode", () => {
  it("sets a conversation to human", async () => {
    const { result } = renderHook(() => useSetConversationMode("cnv_001"), {
      wrapper: createWrapper(),
    });
    const updated = await result.current.mutateAsync("human");
    expect(updated.mode).toBe("human");
  });
});
