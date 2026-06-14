"use client";

import { useEffect } from "react";
import { MOCKING_ENABLED } from "../../config/env";

/**
 * Registers the PWA service worker. Skipped when MSW mocking is on — MSW owns the
 * "/" service-worker scope in dev, so registering /sw.js there would break mocks.
 * Enable for production builds (mocking off).
 */
export function PwaRegister() {
  useEffect(() => {
    if (MOCKING_ENABLED) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // non-fatal
    });
  }, []);

  return null;
}
