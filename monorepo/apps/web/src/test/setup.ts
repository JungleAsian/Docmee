import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "../mocks/handlers";

/** Reuse the exact contract mock handlers for node tests — same seam as the app. */
export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup(); // unmount React trees between tests (globals:false → no auto-cleanup)
  server.resetHandlers();
});
afterAll(() => server.close());

// A bearer token so the handlers' requireAuth() passes by default.
document.cookie = "docmee_token=test.token";
