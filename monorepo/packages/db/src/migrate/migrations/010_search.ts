import type { Migration } from "../runner.js";

/**
 * 010 — Per-clinic message-content search (Phase 2D, Q3).
 *
 * Reconciles FTS with ciphertext-only message bodies (user decision): the message
 * body stays encrypted in content_ciphertext; a DERIVED tsvector (lexemes/stems
 * only — never the readable plaintext) is stored in content_search and indexed
 * with GIN. Search is strictly per-clinic via RLS and audited (G34).
 *
 * Privacy note: content_search persists which word-stems appear (partial PHI
 * exposure), accepted as the tradeoff for tsvector+GIN search.
 */
const sql = /* sql */ `
  ALTER TABLE messages ADD COLUMN content_search tsvector;
  CREATE INDEX messages_content_search ON messages USING gin (content_search);
`;

const migration: Migration = { version: 10, name: "search", sql };
export default migration;
