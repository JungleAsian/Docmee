import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ChannelsPage from "../app/(panel)/settings/channels/page";
import { renderWithProviders } from "../test/react";

describe("ChannelsPage (2B)", () => {
  it("lists channels with WhatsApp connected", async () => {
    renderWithProviders(<ChannelsPage />);
    await waitFor(() => expect(screen.getByText("WhatsApp")).toBeTruthy());
    expect(screen.getByText("Messenger")).toBeTruthy();
    // Only WhatsApp is connected initially.
    expect(screen.getAllByText("Conectado").length).toBe(1);
  });

  it("connects a disconnected channel", async () => {
    renderWithProviders(<ChannelsPage />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Conectar" }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: "Conectar" })[0]!);
    await waitFor(() => expect(screen.getAllByText("Conectado").length).toBeGreaterThanOrEqual(2));
  });
});
