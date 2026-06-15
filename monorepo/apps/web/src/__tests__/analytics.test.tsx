import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AnalyticsPage from "../app/(panel)/analytics/page";
import { renderWithProviders } from "../test/react";

describe("AnalyticsPage (2D)", () => {
  it("renders KPI rollups", async () => {
    renderWithProviders(<AnalyticsPage />);
    await waitFor(() => expect(screen.getByText("128")).toBeTruthy());
    expect(screen.getByText("72%")).toBeTruthy();
  });

  it("searches messages full-text", async () => {
    const { container } = renderWithProviders(<AnalyticsPage />);
    await screen.findByText("128");

    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "cita" } });

    await waitFor(() =>
      expect(screen.getByText(/¿tienen cita disponible esta semana\?/)).toBeTruthy(),
    );
  });
});
