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
export const isUsingPostgres = Boolean(connectionString);
const usePostgres = isUsingPostgres;

let pgPool: pg.Pool | null = null;
if (usePostgres && connectionString) {
  pgPool = new pg.Pool({
    connectionString,
    max: 25,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  pgPool.on('error', (err) => {
    console.error('PostgreSQL pool background error:', err);
  });
  attachDatabasePool(pgPool);
}

const TRANSIENT_PG_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ECONNREFUSED',
]);

function isTransientPgError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code && TRANSIENT_PG_CODES.has(e.code)) {
    return true;
  }
  const msg = (e.message || '').toLowerCase();
  return (
    msg.includes('connection terminated') ||
    msg.includes('timeout exceeded') ||
    msg.includes('too many clients') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withPgRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1 && isTransientPgError(err)) {
        await sleep(70 * (i + 1) + Math.floor(Math.random() * 50));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
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
    pgSchemaReady = withPgRetry(async () => {
      for (const statement of PG_SCHEMA_STATEMENTS) {
        await pgPool!.query(statement);
      }
    }).catch((err) => {
      pgSchemaReady = null;
      throw err;
    });
  }
  return pgSchemaReady;
}

let sqliteDb: DatabaseSync | null = null;

const SQLITE_SCHEMA_SQL = `
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
`;

function resolveWritableDbCandidates(): string[] {
  const paths: string[] = [];
  const dirs = [
    path.resolve(process.cwd(), 'data'),
    path.join(os.tmpdir(), 'candycbt-data'),
  ];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const probe = path.join(dir, '.write-check');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      paths.push(path.join(dir, 'candycbt-runtime.db'));
    } catch {
      // ignore unwritable directory
    }
  }
  paths.push(':memory:');
  return paths;
}

function tryOpenSqlite(dbPath: string, journalMode: 'WAL' | 'DELETE'): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`PRAGMA busy_timeout = 10000;`);
    if (dbPath !== ':memory:') {
      db.exec(`PRAGMA journal_mode = ${journalMode};`);
    }
    db.exec(`PRAGMA synchronous = NORMAL;`);
    db.exec(SQLITE_SCHEMA_SQL);
    return db;
  } catch (err) {
    try {
      db.close();
    } catch {
      // ignore close failure
    }
    throw err;
  }
}

function getSqliteDb(): DatabaseSync {
  if (sqliteDb) {
    return sqliteDb;
  }
  const candidates = resolveWritableDbCandidates();
  let lastError: unknown;
  for (const dbPath of candidates) {
    for (const mode of (dbPath === ':memory:' ? ['DELETE'] : ['WAL', 'DELETE']) as ('WAL' | 'DELETE')[]) {
      try {
        sqliteDb = tryOpenSqlite(dbPath, mode);
        return sqliteDb;
      } catch (err) {
        lastError = err;
        console.warn(`Gagal membuka SQLite (${dbPath}, mode ${mode}):`, err);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Gagal menginisialisasi database SQLite.');
}

function isSqliteBusyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; errcode?: number; message?: string };
  const msg = (e.message || '').toLowerCase();
  return (
    e.code === 'ERR_SQLITE_ERROR' &&
    (msg.includes('locked') || msg.includes('busy'))
  ) || msg.includes('database is locked') || msg.includes('sqlite_busy');
}

async function withSqliteRetry<T>(fn: (db: DatabaseSync) => T, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const db = getSqliteDb();
      return fn(db);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1 && isSqliteBusyError(err)) {
        await sleep(35 * (i + 1) + Math.floor(Math.random() * 25));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function dbInitSessionSecret(candidate: string): Promise<string> {
  if (usePostgres && pgPool) {
    return withPgRetry(async () => {
      await ensurePgSchema();
      await pgPool!.query(
        `INSERT INTO cbt_meta (key, value) VALUES ('session_secret', $1) ON CONFLICT (key) DO NOTHING`,
        [candidate]
      );
      const { rows } = await pgPool!.query<{ value: string }>(
        `SELECT value FROM cbt_meta WHERE key = 'session_secret'`
      );
      return rows[0]?.value || candidate;
    });
  }

  return withSqliteRetry((db) => {
    db.prepare(`INSERT OR IGNORE INTO cbt_meta (key, value) VALUES ('session_secret', ?)`).run(candidate);
    const row = db.prepare(`SELECT value FROM cbt_meta WHERE key = 'session_secret'`).get() as
      | { value?: string }
      | undefined;
    return row?.value || candidate;
  });
}

export async function dbTouchPresence(userId: string, role: string): Promise<void> {
  if (usePostgres && pgPool) {
    await withPgRetry(async () => {
      await ensurePgSchema();
      await pgPool!.query(
        `INSERT INTO cbt_presence (user_id, role, seen_at) VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, seen_at = now()`,
        [userId, role]
      );
    });
    return;
  }

  await withSqliteRetry((db) => {
    db.prepare(
      `INSERT INTO cbt_presence (user_id, role, seen_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET role = excluded.role, seen_at = excluded.seen_at`
    ).run(userId, role, Date.now());
  });
}

export async function dbLoadPresence(): Promise<{ students: number; staff: number }> {
  if (usePostgres && pgPool) {
    return withPgRetry(async () => {
      await ensurePgSchema();
      const { rows } = await pgPool!.query<{ role: string; n: number }>(
        `SELECT role, count(*)::int AS n FROM cbt_presence WHERE seen_at > now() - interval '45 seconds' GROUP BY role`
      );
      const presence = { students: 0, staff: 0 };
      for (const row of rows) {
        if (row.role === 'student') presence.students += row.n;
        else presence.staff += row.n;
      }
      return presence;
    });
  }

  return withSqliteRetry((db) => {
    const cutoff = Date.now() - 45_000;
    const presenceRows = db
      .prepare('SELECT role, count(*) AS n FROM cbt_presence WHERE seen_at > ? GROUP BY role')
      .all(cutoff) as { role: string; n: number }[];

    const presence = { students: 0, staff: 0 };
    for (const row of presenceRows) {
      if (row.role === 'student') presence.students += Number(row.n) || 0;
      else presence.staff += Number(row.n) || 0;
    }
    return presence;
  });
}

export async function dbLoadDocsAndPresence(): Promise<{
  docs: StoredDocRow[];
  presence: { students: number; staff: number };
}> {
  if (usePostgres && pgPool) {
    return withPgRetry(async () => {
      await ensurePgSchema();
      const [docsRes, presenceRes] = await Promise.all([
        pgPool!.query<StoredDocRow>(
          'SELECT collection, id, pos, data FROM cbt_docs ORDER BY collection, pos, id'
        ),
        pgPool!.query<{ role: string; n: number }>(
          `SELECT role, count(*)::int AS n FROM cbt_presence WHERE seen_at > now() - interval '45 seconds' GROUP BY role`
        ),
      ]);
      const presence = { students: 0, staff: 0 };
      for (const row of presenceRes.rows) {
        if (row.role === 'student') presence.students += row.n;
        else presence.staff += row.n;
      }
      return { docs: docsRes.rows, presence };
    });
  }

  return withSqliteRetry((db) => {
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

    const docs: StoredDocRow[] = [];
    for (const row of docRows) {
      try {
        docs.push({
          collection: row.collection,
          id: row.id,
          pos: Number(row.pos),
          data: JSON.parse(row.data),
        });
      } catch (err) {
        console.error(`Melewati dokumen korup (${row.collection}/${row.id}):`, err);
      }
    }

    return { docs, presence };
  });
}

export async function dbFlushChanges(
  upserts: StoredDocRow[],
  deletes: { collection: string; id: string }[],
  events: PendingEventWrite[]
): Promise<void> {
  if (usePostgres && pgPool) {
    await withPgRetry(async () => {
      await ensurePgSchema();
      const client = await pgPool!.connect();
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
    });
    return;
  }

  await withSqliteRetry((db) => {
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

    db.exec('BEGIN IMMEDIATE');
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
  });
}

export function dbPurgeOldEvents(): void {
  if (usePostgres && pgPool) {
    pgPool
      .query(`DELETE FROM cbt_events WHERE created_at < now() - interval '30 minutes'`)
      .catch((err) => console.error('Gagal membersihkan cbt_events:', err));
    pgPool
      .query(`DELETE FROM cbt_presence WHERE seen_at < now() - interval '5 minutes'`)
      .catch(() => undefined);
    return;
  }

  try {
    const db = getSqliteDb();
    const eventCutoff = Date.now() - 30 * 60 * 1000;
    const presenceCutoff = Date.now() - 5 * 60 * 1000;
    db.prepare(`DELETE FROM cbt_events WHERE created_at < ?`).run(eventCutoff);
    db.prepare(`DELETE FROM cbt_presence WHERE seen_at < ?`).run(presenceCutoff);
    try {
      db.exec(`PRAGMA wal_checkpoint(PASSIVE)`);
    } catch {
      // ignore when not in WAL mode
    }
  } catch (err) {
    console.error('Gagal membersihkan cbt_events:', err);
  }
}

export async function dbGetMaxEventId(): Promise<number> {
  if (usePostgres && pgPool) {
    return withPgRetry(async () => {
      await ensurePgSchema();
      const { rows } = await pgPool!.query<{ max: string | null }>('SELECT max(id) AS max FROM cbt_events');
      return Number(rows[0]?.max || 0);
    });
  }

  return withSqliteRetry((db) => {
    const row = db.prepare('SELECT max(id) AS max FROM cbt_events').get() as
      | { max?: number | null }
      | undefined;
    return Number(row?.max || 0);
  });
}

export async function dbGetEventsAfter(
  afterId: number,
  audiences: string[]
): Promise<StoredEventRow[]> {
  if (audiences.length === 0) {
    return [];
  }

  if (usePostgres && pgPool) {
    return withPgRetry(async () => {
      await ensurePgSchema();
      const { rows } = await pgPool!.query<{ id: string; event: string; payload: unknown }>(
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
    });
  }

  return withSqliteRetry((db) => {
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
  });
}

