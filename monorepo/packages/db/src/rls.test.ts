import { describe, expect, it } from "vitest";
import { isLiveDbConfigured } from "./index.js";

/**
 * RLS / tenant-isolation harness (Sprint-0 scaffold; the suite GROWS in Phase 0).
 *
 * These `it.todo` entries enumerate the Phase-0 acceptance gate (foundation
 * decisions §4). They become live assertions against a real Postgres in Phase 0;
 * until infra X6 is provisioned they document the contract and keep CI green.
 *
 * 🔒 This suite protects every later phase — cross-tenant access must be provably
 * impossible at the DB layer.
 */
describe("RLS tenant isolation (Phase 0 acceptance gate)", () => {
  it("exposes a live-DB guard so integration tests skip cleanly until X6", () => {
    expect(typeof isLiveDbConfigured()).toBe("boolean");
  });

  // --- Phase-0 acceptance gate (foundation §4) ---
  it.todo("G4.1 inbound message lands in `messages`, normalized, scoped to Clinic A");
  it.todo("G4.2 querying as Clinic B returns zero of Clinic A's rows (denied at DB)");
  it.todo("G4.3 worker on Clinic A's job reads/writes only Clinic A's data");
  it.todo("G4.3b admin role is the ONLY cross-tenant path (via withAdminContext)");
  it.todo("G4.4 redelivering the same wamid yields exactly one row (idempotency)");
  it.todo("G4.5 send to an opted_out patient is blocked at the chokepoint");
  it.todo("G4.6 unknown phone_number_id is logged + metric++ + dropped (no row)");
  it.todo("G4.7 patients.phone / messages.content stored as ciphertext; HMAC lookup resolves");
  it.todo("G4.8 clinic_users login mints clinic-scoped JWT; platform_users cannot read clinic data");
  it.todo("G4.9 full Phase-0 migration set applies forward from empty DB; /health/ready green");

  // --- R5 carve-out gate tests (decision #1) ---
  it.todo("normal app role is DENIED cross-tenant reads even with buggy code");
  it.todo("admin connection is reachable only via withAdminContext (lint-enforced single import)");
});
