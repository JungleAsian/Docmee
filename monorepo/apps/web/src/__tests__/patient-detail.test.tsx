import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The detail page reads the route param; mock it to a seeded patient.
vi.mock("next/navigation", () => ({
  useParams: () => ({ patientId: "pat_001" }),
}));

import PatientDetailPage from "../app/(panel)/patients/[patientId]/page";
import { renderWithProviders } from "../test/react";

describe("PatientDetailPage (1B)", () => {
  it("shows the patient profile with appointments and conversations", async () => {
    renderWithProviders(<PatientDetailPage />);

    await waitFor(() => expect(screen.getByText("María González")).toBeTruthy());
    expect(screen.getByText("+502 5555 0001")).toBeTruthy();
    // Aggregated history: the confirmed appointment + the WhatsApp conversation.
    await waitFor(() => expect(screen.getByText("Confirmada")).toBeTruthy());
    expect(screen.getByText("WhatsApp")).toBeTruthy();
  });
});
