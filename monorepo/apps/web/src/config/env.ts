/**
 * Centralized runtime config. The contract workflow is mock-first: MSW is on by
 * default in development and off in production. Override explicitly with
 * NEXT_PUBLIC_API_MOCKING = "enabled" | "disabled" (e.g. to hit a real API in dev
 * at a phase's integration checkpoint).
 */
const mockFlag = process.env.NEXT_PUBLIC_API_MOCKING;

export const MOCKING_ENABLED =
  mockFlag === "enabled" || (mockFlag !== "disabled" && process.env.NODE_ENV !== "production");

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.docmee.example/v1";
