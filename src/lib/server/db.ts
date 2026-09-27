import { neon } from "@neondatabase/serverless";
import { getConfig } from "./config";

let schemaReady: Promise<void> | undefined;

export async function database() {
  const sql = neon(getConfig().databaseUrl);
  if (!schemaReady) {
    schemaReady = (async () => {
      // Serialize DDL across cold starts; IF NOT EXISTS alone can still race in PostgreSQL.
      await sql.transaction([
        sql`SELECT pg_advisory_xact_lock(72841029)`,
        sql`CREATE TABLE IF NOT EXISTS afterglow_users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        image TEXT,
        token_cipher TEXT,
        access_expires_at TIMESTAMPTZ NOT NULL,
        refresh_lock_id TEXT,
        refresh_lock_until TIMESTAMPTZ,
        memories JSONB NOT NULL DEFAULT '[]'::jsonb,
        revision INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
        sql`CREATE TABLE IF NOT EXISTS afterglow_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES afterglow_users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL
      )`,
        sql`CREATE INDEX IF NOT EXISTS afterglow_sessions_user ON afterglow_sessions(user_id)`,
        sql`CREATE TABLE IF NOT EXISTS afterglow_listening_plays (
        user_id TEXT NOT NULL REFERENCES afterglow_users(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL,
        played_at TIMESTAMPTZ NOT NULL,
        track JSONB NOT NULL,
        PRIMARY KEY (user_id, track_id, played_at)
      )`,
        sql`CREATE INDEX IF NOT EXISTS afterglow_listening_plays_week ON afterglow_listening_plays(user_id, played_at)`,
        sql`CREATE TABLE IF NOT EXISTS afterglow_listening_sync (
        user_id TEXT PRIMARY KEY REFERENCES afterglow_users(id) ON DELETE CASCADE,
        attempted_at TIMESTAMPTZ NOT NULL,
        synced_at TIMESTAMPTZ,
        error_code TEXT
      )`,
      ]);
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
  return sql;
}
