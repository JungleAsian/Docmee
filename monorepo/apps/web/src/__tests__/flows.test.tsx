import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FlowsPage from "../app/(panel)/settings/flows/page";
import { renderWithProviders } from "../test/react";

describe("FlowsPage (3B)", () => {
  it("lists seeded flows", async () => {
    renderWithProviders(<FlowsPage />);
    await waitFor(() => expect(screen.getByText("Intake primera consulta")).toBeTruthy());
  });

  it("creates a flow", async () => {
    const { container } = renderWithProviders(<FlowsPage />);
    await screen.findByText("Intake primera consulta");
    fireEvent.click(screen.getByRole("button", { name: /Nuevo flujo/ }));
    await waitFor(() => expect(container.querySelector("#f-name")).toBeTruthy());
    fireEvent.change(container.querySelector("#f-name")!, { target: { value: "Triage urgencias" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(screen.getByText("Triage urgencias")).toBeTruthy());
  });
});
