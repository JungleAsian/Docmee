import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppointmentsPage from "../app/(panel)/appointments/page";
import { renderWithProviders } from "../test/react";

describe("AppointmentsPage", () => {
  it("lists seeded appointments", async () => {
    renderWithProviders(<AppointmentsPage />);
    await waitFor(() => expect(screen.getByText("María González")).toBeTruthy());
    // "Confirmada" appears as both a filter chip and the row's status badge.
    expect(screen.getAllByText("Confirmada").length).toBeGreaterThan(0);
  });

  it("books a free slot and shows the new appointment", async () => {
    const { container } = renderWithProviders(<AppointmentsPage />);
    await screen.findByText("María González");

    fireEvent.click(screen.getByRole("button", { name: /Agendar cita/ }));

    // Wait for the patient <select> options to load from the mock.
    await waitFor(() => expect(container.querySelector("#a-patient option[value='pat_002']")).toBeTruthy());

    fireEvent.change(container.querySelector("#a-patient")!, { target: { value: "pat_002" } });
    fireEvent.change(container.querySelector("#a-start")!, { target: { value: "2027-01-10T09:00" } });
    fireEvent.change(container.querySelector("#a-end")!, { target: { value: "2027-01-10T09:30" } });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(screen.getByText("Carlos Ramírez")).toBeTruthy());
  });

  it("surfaces a 409 slot conflict", async () => {
    const { container } = renderWithProviders(<AppointmentsPage />);
    await screen.findByText("María González");

    fireEvent.click(screen.getByRole("button", { name: /Agendar cita/ }));
    await waitFor(() => expect(container.querySelector("#a-patient option[value='pat_001']")).toBeTruthy());

    // Overlaps the seeded 2026-06-16 appointment regardless of timezone offset
    // because it spans the whole day.
    fireEvent.change(container.querySelector("#a-patient")!, { target: { value: "pat_001" } });
    fireEvent.change(container.querySelector("#a-start")!, { target: { value: "2026-06-16T00:00" } });
    fireEvent.change(container.querySelector("#a-end")!, { target: { value: "2026-06-16T23:59" } });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(screen.getByText(/ya está ocupado/)).toBeTruthy());
  });
});
