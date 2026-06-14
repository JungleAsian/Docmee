/**
 * Readiness model (G4): `/health/ready` checks the dependencies the process needs
 * to serve traffic — Postgres, Redis, and the encryption key/Vault. External
 * providers (LLM/ASR/Meta/Google) are deliberately EXCLUDED so a provider outage
 * never marks us not-ready. Results are cached briefly to keep the check cheap.
 */
export interface ReadinessCheck {
  name: string;
  /** Resolve true if the dependency is healthy. Should be cheap and time-bounded. */
  check: () => Promise<boolean>;
}

export interface ReadinessResult {
  ready: boolean;
  checks: Record<string, "up" | "down">;
}

const CACHE_TTL_MS = 5000;

export class ReadinessRegistry {
  private readonly checks: ReadinessCheck[] = [];
  private cached: { at: number; result: ReadinessResult } | null = null;

  /** Register a dependency check (called by db/redis/secrets wiring in Phase 0). */
  add(check: ReadinessCheck): void {
    this.checks.push(check);
  }

  async evaluate(now: number = Date.now()): Promise<ReadinessResult> {
    if (this.cached && now - this.cached.at < CACHE_TTL_MS) {
      return this.cached.result;
    }

    const entries = await Promise.all(
      this.checks.map(async (c) => {
        let ok = false;
        try {
          ok = await c.check();
        } catch {
          ok = false;
        }
        return [c.name, ok ? "up" : "down"] as const;
      }),
    );

    const result: ReadinessResult = {
      ready: entries.every(([, status]) => status === "up"),
      checks: Object.fromEntries(entries),
    };
    this.cached = { at: now, result };
    return result;
  }
}
