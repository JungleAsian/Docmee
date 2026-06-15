import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toaster } from "../components/toast/toaster";
import { toast } from "../lib/toast";

describe("Toaster", () => {
  it("renders a message published via toast()", async () => {
    render(<Toaster />);
    act(() => {
      toast("Algo salió mal", "error");
    });
    await waitFor(() => expect(screen.getByText("Algo salió mal")).toBeTruthy());
  });
});
