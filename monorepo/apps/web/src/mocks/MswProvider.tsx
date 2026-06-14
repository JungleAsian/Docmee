"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MOCKING_ENABLED } from "../config/env";

/**
 * Boots the MSW browser worker exactly once before rendering children, so the
 * very first data fetch is already intercepted. A module-level singleton makes
 * this resilient to React StrictMode's double-invoked effects in dev (otherwise
 * two competing `worker.start()` calls can leave the gate stuck). No-op (renders
 * immediately) when mocking is disabled — i.e. once a phase flips to the real API.
 */
let workerStarted: Promise<void> | null = null;

function startWorkerOnce(): Promise<void> {
  if (!workerStarted) {
    workerStarted = import("./browser").then(({ worker }) =>
      worker.start({ onUnhandledRequest: "bypass" }).then(() => undefined),
    );
  }
  return workerStarted;
}

export function MswProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!MOCKING_ENABLED);

  useEffect(() => {
    if (MOCKING_ENABLED && !ready) {
      let active = true;
      void startWorkerOnce().then(() => {
        if (active) setReady(true);
      });
      return () => {
        active = false;
      };
    }
    return undefined;
  }, [ready]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }
  return <>{children}</>;
}
