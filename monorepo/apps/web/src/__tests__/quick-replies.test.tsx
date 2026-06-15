import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import QuickRepliesPage from "../app/(panel)/settings/quick-replies/page";
import { renderWithProviders } from "../test/react";

describe("QuickRepliesPage (2A)", () => {
  it("lists seeded quick replies", async () => {
    renderWithProviders(<QuickRepliesPage />);
    await waitFor(() => expect(screen.getByText("/horario")).toBeTruthy());
    expect(screen.getByText("/ubicacion")).toBeTruthy();
  });

  it("creates a quick reply", async () => {
    const { container } = renderWithProviders(<QuickRepliesPage />);
    await screen.findByText("/horario");
    fireEvent.click(screen.getByRole("button", { name: /Nueva respuesta/ }));
    await waitFor(() => expect(container.querySelector("#qr-shortcut")).toBeTruthy());
    fireEvent.change(container.querySelector("#qr-shortcut")!, { target: { value: "/precios" } });
    fireEvent.change(container.querySelector("#qr-body")!, { target: { value: "Consulta general Q200." } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(screen.getByText("/precios")).toBeTruthy());
  });
});
