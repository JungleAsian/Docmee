import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsPage from "../app/(panel)/settings/notifications/page";
import { renderWithProviders } from "../test/react";

describe("NotificationsPage (3D push)", () => {
  beforeEach(() => {
    (globalThis as unknown as { Notification: unknown }).Notification = {
      permission: "default",
      requestPermission: vi.fn(async () => "granted"),
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { Notification?: unknown }).Notification;
  });

  it("enables push notifications after permission is granted", async () => {
    renderWithProviders(<NotificationsPage />);
    const btn = await screen.findByRole("button", { name: "Activar notificaciones" });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText("Notificaciones activas")).toBeTruthy());
  });
});
