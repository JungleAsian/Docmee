import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TeamPage from "../app/(panel)/settings/team/page";
import { renderWithProviders } from "../test/react";

describe("TeamPage (RBAC)", () => {
  it("lists clinic users", async () => {
    renderWithProviders(<TeamPage />);
    await waitFor(() => expect(screen.getByText("Luis Morales")).toBeTruthy());
    expect(screen.getByText("Dr. Jorge Díaz")).toBeTruthy();
  });

  it("changes a user's role via the select", async () => {
    const { container } = renderWithProviders(<TeamPage />);
    await screen.findByText("Dra. Ana Pérez");

    // First per-user role select (invite form is closed → only row selects exist).
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    fireEvent.change(select, { target: { value: "doctor" } });

    await waitFor(() => {
      const refreshed = container.querySelector("select") as HTMLSelectElement;
      expect(refreshed.value).toBe("doctor");
    });
  });
});
