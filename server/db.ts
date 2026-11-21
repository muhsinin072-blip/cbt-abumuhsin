import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL belum diset. Hubungkan integrasi Neon ke project ini.');
}

export const pool = new pg.Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 10_000,
});

attachDatabasePool(pool);

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS cbt_docs (
    collection text NOT NULL,
    id text NOT NULL,
    pos double precision NOT NULL DEFAULT 0,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (collection, id)
  )`,
  `CREATE TABLE IF NOT EXISTS cbt_events (
    id bigserial PRIMARY KEY,
    audience text NOT NULL,
    event text NOT NULL,
    payload jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS cbt_events_audience_id_idx ON cbt_events (audience, id)`,
  `CREATE TABLE IF NOT EXISTS cbt_presence (
    user_id text PRIMARY KEY,
    role text NOT NULL,
    seen_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS cbt_meta (
    key text PRIMARY KEY,
    value text NOT NULL
  )`,
];

let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await pool.query(statement);
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
