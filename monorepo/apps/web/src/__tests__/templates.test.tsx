import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TemplatesPage from "../app/(panel)/settings/templates/page";
import { renderWithProviders } from "../test/react";

describe("TemplatesPage (2C)", () => {
  it("lists the seeded template", async () => {
    renderWithProviders(<TemplatesPage />);
    await waitFor(() => expect(screen.getByText("recordatorio_cita")).toBeTruthy());
  });

  it("creates a draft then submits it for approval", async () => {
    const { container } = renderWithProviders(<TemplatesPage />);
    await screen.findByText("recordatorio_cita");

    fireEvent.click(screen.getByRole("button", { name: /Nueva plantilla/ }));
    await waitFor(() => expect(container.querySelector("#tpl-name")).toBeTruthy());
    fireEvent.change(container.querySelector("#tpl-name")!, { target: { value: "bienvenida" } });
    fireEvent.change(container.querySelector("#tpl-body")!, { target: { value: "Hola {{1}}" } });
    fireEvent.submit(container.querySelector("form")!);

    // New draft appears with a "Borrador" badge + a submit button.
    await waitFor(() => expect(screen.getByText("bienvenida")).toBeTruthy());
    expect(screen.getByText("Borrador")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Enviar a aprobación" }));
    await waitFor(() => expect(screen.getByText("Pendiente")).toBeTruthy());
  });
});
