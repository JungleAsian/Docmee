import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import InboxPage from "../app/(panel)/inbox/page";
import { renderWithProviders } from "../test/react";

describe("InboxPage", () => {
  it("lists conversations with patient names", async () => {
    renderWithProviders(<InboxPage />);
    await waitFor(() => expect(screen.getByText("María González")).toBeTruthy());
    expect(screen.getByText("Carlos Ramírez")).toBeTruthy();
  });

  it("opens a conversation and shows its message history", async () => {
    renderWithProviders(<InboxPage />);
    const row = await screen.findByText("María González");
    fireEvent.click(row);
    await waitFor(() =>
      expect(screen.getByText(/¿tienen cita disponible esta semana\?/)).toBeTruthy(),
    );
  });

  it("sends a staff message and it appears in the thread", async () => {
    const { container } = renderWithProviders(<InboxPage />);
    fireEvent.click(await screen.findByText("Carlos Ramírez"));
    await waitFor(() => expect(container.querySelector("textarea")).toBeTruthy());

    const textarea = container.querySelector("textarea")!;
    fireEvent.change(textarea, { target: { value: "Mensaje de prueba" } });
    fireEvent.submit(textarea.closest("form")!);

    const thread = container.querySelector("main") ?? container;
    await waitFor(() =>
      expect(within(thread as HTMLElement).getByText("Mensaje de prueba")).toBeTruthy(),
    );
  });
});
