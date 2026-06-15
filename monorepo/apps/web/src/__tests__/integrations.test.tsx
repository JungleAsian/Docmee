import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import IntegrationsPage from "../app/(panel)/settings/integrations/page";
import { renderWithProviders } from "../test/react";

describe("IntegrationsPage (3C)", () => {
  it("lists ingested documents", async () => {
    renderWithProviders(<IntegrationsPage />);
    await waitFor(() =>
      expect(screen.getByText("indicaciones-postoperatorias.pdf")).toBeTruthy(),
    );
    expect(screen.getByText("Ingresado")).toBeTruthy();
  });

  it("gates export creation behind written consent (SEC24)", async () => {
    const { container } = renderWithProviders(<IntegrationsPage />);
    await screen.findByText("indicaciones-postoperatorias.pdf");

    const createBtn = screen.getByRole("button", { name: "Crear" }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true); // no consent yet

    const consent = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(consent);
    expect(createBtn.disabled).toBe(false);

    fireEvent.click(createBtn);
    await waitFor(() => expect(screen.getByText("Pendiente")).toBeTruthy());
  });
});
