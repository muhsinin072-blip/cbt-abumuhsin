import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';

export interface StoredDocRow {
  collection: string;
  id: string;
  pos: number;
  data: unknown;
}

export interface StoredEventRow {
  id: number;
  event: string;
  payload: unknown;
}

export interface PendingEventWrite {
  audience: string;
  event: string;
  payload: unknown;
}

const connectionString = process.env.DATABASE_URL?.trim();
const usePostgres = Boolean(connectionString);

let pgPool: pg.Pool | null = null;
if (usePostgres && connectionString) {
  pgPool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
  });
  attachDatabasePool(pgPool);
}

const PG_SCHEMA_STATEMENTS = [
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

let pgSchemaReady: Promise<void> | null = null;

function ensurePgSchema(): Promise<void> {
  if (!pgPool) {
    return Promise.reject(new Error('PostgreSQL pool belum diinisialisasi.'));
  }
  if (!pgSchemaReady) {
    pgSchemaReady = (async () => {
      for (const statement of PG_SCHEMA_STATEMENTS) {
        await pgPool!.query(statement);
      }
    })().catch((err) => {
      pgSchemaReady = null;
      throw err;
    });
  }
  return pgSchemaReady;
}

let sqliteDb: DatabaseSync | null = null;

function resolveSqlitePath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'data'),
    path.join(os.tmpdir(), 'candycbt-data'),
  ];
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const probe = path.join(dir, '.write-check');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return path.join(dir, 'candycbt-runtime.db');
    } catch {
      // try next directory
    }
  }
  return ':memory:';
}

function getSqliteDb(): DatabaseSync {
  if (sqliteDb) {
    return sqliteDb;
  }
  const dbPath = resolveSqlitePath();
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS cbt_docs (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      pos REAL NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE TABLE IF NOT EXISTS cbt_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audience TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cbt_events_audience_id_idx ON cbt_events (audience, id);
    CREATE TABLE IF NOT EXISTS cbt_presence (
      user_id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      seen_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cbt_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  sqliteDb = db;
  return db;
}

export async function dbInitSessionSecret(candidate: string): Promise<string> {
  if (usePostgres && pgPool) {
    await ensurePgSchema();
    await pgPool.query(
      `INSERT INTO cbt_meta (key, value) VALUES ('session_secret', $1) ON CONFLICT (key) DO NOTHING`,
      [candidate]
    );
    const { rows } = await pgPool.query<{ value: string }>(
      `SELECT value FROM cbt_meta WHERE key = 'session_secret'`
    );
    return rows[0]?.value || candidate;
  }

  const db = getSqliteDb();
  db.prepare(`INSERT OR IGNORE INTO cbt_meta (key, value) VALUES ('session_secret', ?)`).run(candidate);
  const row = db.prepare(`SELECT value FROM cbt_meta WHERE key = 'session_secret'`).get() as
    | { value?: string }
    | undefined;
  return row?.value || candidate;
}

export async function dbTouchPresence(userId: string, role: string): Promise<void> {
  if (usePostgres && pgPool) {
    await ensurePgSchema();
    await pgPool.query(
      `INSERT INTO cbt_presence (user_id, role, seen_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, seen_at = now()`,
      [userId, role]
    );
    return;
  }

  const db = getSqliteDb();
  db.prepare(
    `INSERT INTO cbt_presence (user_id, role, seen_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET role = excluded.role, seen_at = excluded.seen_at`
  ).run(userId, role, Date.now());
}

export async function dbLoadDocsAndPresence(): Promise<{
  docs: StoredDocRow[];
  presence: { students: number; staff: number };
}> {
  if (usePostgres && pgPool) {
    await ensurePgSchema();
    const [docsRes, presenceRes] = await Promise.all([
      pgPool.query<StoredDocRow>(
        'SELECT collection, id, pos, data FROM cbt_docs ORDER BY collection, pos, id'
      ),
      pgPool.query<{ role: string; n: number }>(
        `SELECT role, count(*)::int AS n FROM cbt_presence WHERE seen_at > now() - interval '45 seconds' GROUP BY role`
      ),
    ]);
    const presence = { students: 0, staff: 0 };
    for (const row of presenceRes.rows) {
      if (row.role === 'student') presence.students += row.n;
      else presence.staff += row.n;
    }
    return { docs: docsRes.rows, presence };
  }

  const db = getSqliteDb();
  const docRows = db
    .prepare('SELECT collection, id, pos, data FROM cbt_docs ORDER BY collection, pos, id')
    .all() as { collection: string; id: string; pos: number; data: string }[];
  const cutoff = Date.now() - 45_000;
  const presenceRows = db
    .prepare('SELECT role, count(*) AS n FROM cbt_presence WHERE seen_at > ? GROUP BY role')
    .all(cutoff) as { role: string; n: number }[];

  const presence = { students: 0, staff: 0 };
  for (const row of presenceRows) {
    if (row.role === 'student') presence.students += Number(row.n) || 0;
    else presence.staff += Number(row.n) || 0;
  }

  const docs: StoredDocRow[] = docRows.map((row) => ({
    collection: row.collection,
    id: row.id,
    pos: Number(row.pos),
    data: JSON.parse(row.data),
  }));

  return { docs, presence };
}

export async function dbFlushChanges(
  upserts: StoredDocRow[],
  deletes: { collection: string; id: string }[],
  events: PendingEventWrite[]
): Promise<void> {
  if (usePostgres && pgPool) {
    await ensurePgSchema();
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      if (upserts.length > 0) {
        await client.query(
          `INSERT INTO cbt_docs (collection, id, pos, data)
           SELECT x.collection, x.id, x.pos, x.data
           FROM jsonb_to_recordset($1::jsonb) AS x(collection text, id text, pos double precision, data jsonb)
           ON CONFLICT (collection, id) DO UPDATE
           SET pos = EXCLUDED.pos, data = EXCLUDED.data, updated_at = now()`,
          [JSON.stringify(upserts)]
        );
      }
      if (deletes.length > 0) {
        await client.query(
          `DELETE FROM cbt_docs d
           USING jsonb_to_recordset($1::jsonb) AS x(collection text, id text)
           WHERE d.collection = x.collection AND d.id = x.id`,
          [JSON.stringify(deletes)]
        );
      }
      if (events.length > 0) {
        await client.query(
          `INSERT INTO cbt_events (audience, event, payload)
           SELECT x.audience, x.event, x.payload
           FROM jsonb_to_recordset($1::jsonb) AS x(audience text, event text, payload jsonb)`,
          [JSON.stringify(events.map((e) => ({ ...e, payload: e.payload ?? null })))]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  const db = getSqliteDb();
  const now = Date.now();
  const upsertStmt = db.prepare(
    `INSERT INTO cbt_docs (collection, id, pos, data, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (collection, id) DO UPDATE
     SET pos = excluded.pos, data = excluded.data, updated_at = excluded.updated_at`
  );
  const deleteStmt = db.prepare(`DELETE FROM cbt_docs WHERE collection = ? AND id = ?`);
  const insertEventStmt = db.prepare(
    `INSERT INTO cbt_events (audience, event, payload, created_at) VALUES (?, ?, ?, ?)`
  );

  db.exec('BEGIN');
  try {
    for (const item of upserts) {
      upsertStmt.run(item.collection, item.id, item.pos, JSON.stringify(item.data), now);
    }
    for (const del of deletes) {
      deleteStmt.run(del.collection, del.id);
    }
    for (const ev of events) {
      insertEventStmt.run(ev.audience, ev.event, JSON.stringify(ev.payload ?? null), now);
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw err;
  }
}

export function dbPurgeOldEvents(): void {
  if (usePostgres && pgPool) {
    pgPool
      .query(`DELETE FROM cbt_events WHERE created_at < now() - interval '2 hours'`)
      .catch((err) => console.error('Gagal membersihkan cbt_events:', err));
    return;
  }

  try {
    const db = getSqliteDb();
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    db.prepare(`DELETE FROM cbt_events WHERE created_at < ?`).run(cutoff);
  } catch (err) {
    console.error('Gagal membersihkan cbt_events:', err);
  }
}

export async function dbGetMaxEventId(): Promise<number> {
  if (usePostgres && pgPool) {
    await ensurePgSchema();
    const { rows } = await pgPool.query<{ max: string | null }>('SELECT max(id) AS max FROM cbt_events');
    return Number(rows[0]?.max || 0);
  }

  const db = getSqliteDb();
  const row = db.prepare('SELECT max(id) AS max FROM cbt_events').get() as
    | { max?: number | null }
    | undefined;
  return Number(row?.max || 0);
}

export async function dbGetEventsAfter(
  afterId: number,
  audiences: string[]
): Promise<StoredEventRow[]> {
  if (audiences.length === 0) {
    return [];
  }

  if (usePostgres && pgPool) {
    await ensurePgSchema();
    const { rows } = await pgPool.query<{ id: string; event: string; payload: unknown }>(
      `SELECT id, event, payload FROM cbt_events
       WHERE id > $1 AND audience = ANY($2::text[])
       ORDER BY id ASC LIMIT 200`,
      [afterId, audiences]
    );
    return rows.map((r) => ({
      id: Number(r.id),
      event: r.event,
      payload: r.payload,
    }));
  }

  const db = getSqliteDb();
  const placeholders = audiences.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, event, payload FROM cbt_events
       WHERE id > ? AND audience IN (${placeholders})
       ORDER BY id ASC LIMIT 200`
    )
    .all(afterId, ...audiences) as { id: number; event: string; payload: string | null }[];

  return rows.map((r) => {
    let payload: unknown = null;
    if (r.payload) {
      try {
        payload = JSON.parse(r.payload);
      } catch {
        payload = null;
      }
    }
    return {
      id: Number(r.id),
      event: r.event,
      payload,
    };
  });
}
