import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sqlite = new Database(path, { create: true, strict: true });
  if (path !== ":memory:") chmodSync(path, 0o600);
  sqlite.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  // Versioned, idempotent schema. Deployment runs only the service's own DB.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
      disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS session_owner ON session(user_id);
    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at INTEGER, refresh_token_expires_at INTEGER,
      scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(provider_id,account_id)
    );
    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS verification_identifier ON verification(identifier);
    CREATE TABLE IF NOT EXISTS rate_limit (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL, last_request INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invite (
      id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL COLLATE NOCASE,
      created_by TEXT NOT NULL REFERENCES user(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      consumed_at INTEGER, consumed_by TEXT REFERENCES user(id), revoked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS password_reset (
      secret_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS device_authorization (
      code_hash TEXT PRIMARY KEY, user_code_hash TEXT NOT NULL UNIQUE, code_challenge TEXT NOT NULL,
      device_name TEXT NOT NULL, platform TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      approved_by TEXT REFERENCES user(id), approved_at INTEGER, consumed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS device (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      name TEXT NOT NULL, platform TEXT NOT NULL, credential_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER, metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS device_owner ON device(user_id);
    CREATE TABLE IF NOT EXISTS record (
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, collection TEXT NOT NULL, id TEXT NOT NULL,
      version INTEGER NOT NULL, cursor INTEGER NOT NULL, data_json TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id,collection,id)
    );
    CREATE TABLE IF NOT EXISTS change_log (
      cursor INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      collection TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL, data_json TEXT,
      deleted INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS change_owner_cursor ON change_log(user_id,cursor);
    CREATE TABLE IF NOT EXISTS operation (
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, op_id TEXT NOT NULL, request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,op_id)
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL, created_at INTEGER NOT NULL, name TEXT NOT NULL
    );
    INSERT OR IGNORE INTO schema_version(version) VALUES (1);
  `);
  return { sqlite, db: drizzle(sqlite, { schema }), close: () => sqlite.close() };
}
export type ZenoDatabase = ReturnType<typeof openDatabase>;
