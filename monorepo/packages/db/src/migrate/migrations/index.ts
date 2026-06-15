import type { Migration } from "../runner.js";
import m001 from "./001_foundation.js";
import m002 from "./002_messaging.js";
import m003 from "./003_kb.js";
import m004 from "./004_crm.js";
import m005 from "./005_scheduling.js";
import m006 from "./006_ops.js";
import m007 from "./007_channels.js";
import m008 from "./008_automation.js";
import m009 from "./009_analytics.js";
import m010 from "./010_search.js";
import m011 from "./011_multidoctor.js";
import m012 from "./012_flows.js";
import m013 from "./013_integrations.js";

/** All migrations, in apply order. Append-only — never edit a shipped migration. */
export const migrations: readonly Migration[] = [
  m001, m002, m003, m004, m005, m006, m007, m008, m009, m010, m011, m012, m013,
];
