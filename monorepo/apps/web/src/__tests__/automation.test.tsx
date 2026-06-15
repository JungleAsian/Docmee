import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AutomationPage from "../app/(panel)/settings/automation/page";
import { renderWithProviders } from "../test/react";

describe("AutomationPage (2C)", () => {
  it("loads settings and saves an update", async () => {
    const { container } = renderWithProviders(<AutomationPage />);
    // Wait for the form to hydrate from the mock settings.
    await waitFor(() => expect(container.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0));

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    // Toggle the follow-ups checkbox (second one).
    fireEvent.click(checkboxes[1]!);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.getByText("Guardado")).toBeTruthy());
  });
});
