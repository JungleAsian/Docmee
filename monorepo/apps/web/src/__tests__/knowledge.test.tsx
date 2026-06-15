import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import KnowledgePage from "../app/(panel)/knowledge/page";
import { renderWithProviders } from "../test/react";

describe("KnowledgePage", () => {
  it("lists seeded KB entries", async () => {
    renderWithProviders(<KnowledgePage />);
    await waitFor(() => expect(screen.getByText("Horario de atención")).toBeTruthy());
    expect(screen.getByText("Regla de seguridad médica")).toBeTruthy();
  });

  it("creates a new entry and shows it in the list", async () => {
    const { container } = renderWithProviders(<KnowledgePage />);
    await screen.findByText("Horario de atención");

    fireEvent.click(screen.getByRole("button", { name: /Nueva entrada/ }));
    await waitFor(() => expect(container.querySelector("#kb-content")).toBeTruthy());

    fireEvent.change(container.querySelector("#kb-title")!, {
      target: { value: "Política de cancelación" },
    });
    fireEvent.change(container.querySelector("#kb-content")!, {
      target: { value: "Avisar con 24h de anticipación." },
    });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(screen.getByText("Política de cancelación")).toBeTruthy());
  });
});
