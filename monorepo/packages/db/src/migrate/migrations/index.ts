import type { Migration } from "../runner.js";
import m001 from "./001_foundation.js";
import m002 from "./002_messaging.js";
import m003 from "./003_kb.js";
import m004 from "./004_crm.js";
import m005 from "./005_scheduling.js";

/** All migrations, in apply order. Append-only — never edit a shipped migration. */
export const migrations: readonly Migration[] = [m001, m002, m003, m004, m005];
