import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Minimal persistence for a protocol side: the message-ID map, the retained
 * kernel message cache and the QQ-to-UID contact cache. No AI jobs, no plugin
 * state, no message bodies beyond what OneBot actions must be able to answer.
 */
export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.closed = false;
  }
  get(key) { return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value ?? null; }
  set(key, value) {
    this.db.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, String(value));
  }
  cleanup() {
    // Kernel message rows and ID mappings are pruned by the driver, which knows
    // the retention window and must never recycle a OneBot int32 ID.
    this.db.exec('PRAGMA wal_checkpoint(PASSIVE);');
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.db.close(); } catch {}
  }
}
