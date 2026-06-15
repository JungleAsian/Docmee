import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DoctorsPage from "../app/(panel)/settings/doctors/page";
import { renderWithProviders } from "../test/react";

describe("DoctorsPage (3A)", () => {
  it("lists seeded doctors", async () => {
    renderWithProviders(<DoctorsPage />);
    await waitFor(() => expect(screen.getByText("Dr. Jorge Díaz")).toBeTruthy());
    expect(screen.getByText("Pediatría")).toBeTruthy();
  });

  it("creates a doctor", async () => {
    const { container } = renderWithProviders(<DoctorsPage />);
    await screen.findByText("Dr. Jorge Díaz");
    fireEvent.click(screen.getByRole("button", { name: /Nuevo doctor/ }));
    await waitFor(() => expect(container.querySelector("#d-name")).toBeTruthy());
    fireEvent.change(container.querySelector("#d-name")!, { target: { value: "Dra. Lucía Soto" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(screen.getByText("Dra. Lucía Soto")).toBeTruthy());
  });
});
