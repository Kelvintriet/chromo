import { join } from "https://deno.land/std@0.210.0/path/mod.ts";
import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

export const CHROMO_DIR = ".chromolite";
export const DB_PATH = join(CHROMO_DIR, "chrono.db");

// --- DB setup ---
export function getDB() {
    const db = new DB(DB_PATH);

    db.execute(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER,
      message TEXT
    );
    CREATE TABLE IF NOT EXISTS blobs (
      hash TEXT PRIMARY KEY,
      data BLOB
    );
    CREATE TABLE IF NOT EXISTS snapshot_files (
      snapshot_id INTEGER,
      file_path TEXT,
      blob_hash TEXT,
      PRIMARY KEY (snapshot_id, file_path)
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value INTEGER
    );
  `);

    // Initialize current index if missing
    const row = db.query("SELECT value FROM meta WHERE key = 'current_index'");
    if (row.length === 0) {
        db.query("INSERT INTO meta (key, value) VALUES ('current_index', 0)");
    }

    return db;
}

// --- DB helpers ---
export function getCurrentIndex(db: DB): number {
    const [row] = db.query("SELECT value FROM meta WHERE key = 'current_index'");
    return row[0] as number;
}

export function setCurrentIndex(db: DB, index: number) {
    db.query("UPDATE meta SET value = ? WHERE key = 'current_index'", [index]);
}
