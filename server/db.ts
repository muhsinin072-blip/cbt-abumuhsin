import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';

type SqliteDatabaseSync = import('node:sqlite').DatabaseSync;

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

function isLocalPgHost(host: string): boolean {
  const lower = host.trim().toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    lower.startsWith('/cloudsql/') ||
    lower.startsWith('/var/run/')
  );
}

function normalizeRawConnectionString(input?: string): string {
  if (!input) return '';
  let value = input.trim();
  // Handle accidental copy-paste like: psql 'postgresql://...'
  if (/^psql\s+/i.test(value)) {
    value = value.replace(/^psql\s+/i, '').trim();
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function resolvePostgresConfig(): pg.PoolConfig | null {
  const rawUrl = normalizeRawConnectionString(
    process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_URL_NON_POOLING
  );

  const isServerless = process.env.VERCEL === '1';
  const defaultPoolMax = isServerless ? 12 : 25;
  const poolMax = Math.max(5, Math.min(50, Number(process.env.PG_POOL_MAX) || defaultPoolMax));

  if (rawUrl) {
    let cleanedUrl = rawUrl;
    let hostname = '';
    let sslMode = (process.env.PGSSLMODE || '').trim().toLowerCase();

    try {
      const parsed = new URL(rawUrl);
      hostname = parsed.hostname.toLowerCase();
      const urlSslMode = (parsed.searchParams.get('sslmode') || '').trim().toLowerCase();
      if (urlSslMode) {
        sslMode = urlSslMode;
        if (urlSslMode !== 'verify-full' && urlSslMode !== 'verify-ca' && urlSslMode !== 'disable') {
          parsed.searchParams.delete('sslmode');
          cleanedUrl = parsed.toString();
        }
      }
    } catch {
      // keep rawUrl if non-standard URI
    }

    const forceNoSsl = sslMode === 'disable';
    const remoteHost = hostname ? !isLocalPgHost(hostname) : false;
    const useSsl =
      !forceNoSsl &&
      (remoteHost || sslMode === 'require' || sslMode === 'verify-full' || sslMode === 'verify-ca');

    return {
      connectionString: cleanedUrl,
      max: poolMax,
      connectionTimeoutMillis: 20_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 15_000,
      keepAlive: true,
      allowExitOnIdle: isServerless,
      ...(useSsl
        ? {
            ssl: {
              rejectUnauthorized: sslMode === 'verify-full' || sslMode === 'verify-ca',
            },
          }
        : {}),
    };
  }

  const host = process.env.PGHOST?.trim();
  const database = process.env.PGDATABASE?.trim();
  const user = process.env.PGUSER?.trim();
  const password = process.env.PGPASSWORD;

  if (host && database && user) {
    const sslMode = (process.env.PGSSLMODE || '').trim().toLowerCase();
    const forceNoSsl = sslMode === 'disable';
    const useSsl =
      !forceNoSsl &&
      (!isLocalPgHost(host) || sslMode === 'require' || sslMode === 'verify-full' || sslMode === 'verify-ca');

    return {
      host,
      port: Number(process.env.PGPORT) || 5432,
      database,
      user,
      password,
      max: poolMax,
      connectionTimeoutMillis: 20_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 15_000,
      keepAlive: true,
      allowExitOnIdle: isServerless,
      ...(useSsl
        ? {
            ssl: {
              rejectUnauthorized: sslMode === 'verify-full' || sslMode === 'verify-ca',
            },
          }
        : {}),
    };
  }

  return null;
}

const pgConfig = resolvePostgresConfig();
export const isUsingPostgres = Boolean(pgConfig);
const usePostgres = isUsingPostgres;

declare global {
  var __candyCbtPgPool: pg.Pool | undefined;
}

let pgPool: pg.Pool | null = null;
if (usePostgres && pgConfig) {
  if (!globalThis.__candyCbtPgPool) {
    globalThis.__candyCbtPgPool = new pg.Pool(pgConfig);
    globalThis.__candyCbtPgPool.on('error', (err) => {
      console.error('PostgreSQL pool background error:', err);
    });
    attachDatabasePool(globalThis.__candyCbtPgPool);
  }
  pgPool = globalThis.__candyCbtPgPool;
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
  '08P01',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ECONNREFUSED',
  'EAI_AGAIN',
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
    msg.includes('terminating connection') ||
    msg.includes('timeout exceeded') ||
    msg.includes('connection timeout') ||
    msg.includes('too many clients') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('could not connect')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withPgRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1 && isTransientPgError(err)) {
        await sleep(100 * (i + 1) + Math.floor(Math.random() * 80));
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
  `CREATE INDEX IF NOT EXISTS cbt_docs_collection_pos_idx ON cbt_docs (collection, pos, id)`,
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
      const check = await pgPool!.query<{
        docs: string | null;
        events: string | null;
        presence: string | null;
        meta: string | null;
      }>(
        `SELECT
           to_regclass('public.cbt_docs')::text AS docs,
           to_regclass('public.cbt_events')::text AS events,
           to_regclass('public.cbt_presence')::text AS presence,
           to_regclass('public.cbt_meta')::text AS meta`
      );
      const row = check.rows[0];
      if (row?.docs && row?.events && row?.presence && row?.meta) {
        return;
      }

      const client = await pgPool!.connect();
      try {
        await client.query('SELECT pg_advisory_lock(84291042)');
        for (const statement of PG_SCHEMA_STATEMENTS) {
          await client.query(statement);
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock(84291042)').catch(() => undefined);
        client.release();
      }
    }).catch((err) => {
      pgSchemaReady = null;
      throw err;
    });
  }
  return pgSchemaReady;
}

export interface DbErrorClassification {
  code: string;
  retryable: boolean;
  userMessage: string;
  logSummary: string;
}

export function classifyDbError(err: unknown): DbErrorClassification {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: string; message?: string };
  const pgCode = typeof e.code === 'string' ? e.code : '';
  const rawMessage = (e.message || String(err || 'Unknown database error')).replace(
    /postgres(?:ql)?:\/\/\S+/gi,
    '[redacted]'
  );
  const lower = rawMessage.toLowerCase();

  if (pgCode === '53000' || lower.includes('exceeded the quota') || lower.includes('compute time quota')) {
    return {
      code: 'DB_QUOTA_EXCEEDED',
      retryable: false,
      userMessage:
        'Kuota database PostgreSQL (Neon) pada DATABASE_URL sudah habis/terlampaui. Perbarui DATABASE_URL di Secrets dengan project Neon atau PostgreSQL baru, lalu restart server.',
      logSummary: `PostgreSQL quota exceeded (${pgCode || '53000'}): ${rawMessage}`,
    };
  }

  if (pgCode === '28P01' || pgCode === '28000' || pgCode === '3D000' || lower.includes('password authentication failed')) {
    return {
      code: 'DB_CONFIG_ERROR',
      retryable: false,
      userMessage:
        'Konfigurasi DATABASE_URL PostgreSQL tidak valid atau autentikasi ditolak. Periksa kembali DATABASE_URL di Secrets.',
      logSummary: `PostgreSQL config/auth error (${pgCode || 'auth'}): ${rawMessage}`,
    };
  }

  return {
    code: 'DB_UNAVAILABLE',
    retryable: true,
    userMessage: 'Database CBT tidak dapat dihubungi. Coba beberapa saat lagi.',
    logSummary: `${pgCode ? `[${pgCode}] ` : ''}${rawMessage}`,
  };
}

export async function dbCheckHealth(): Promise<{ ok: boolean; engine: 'postgresql' | 'sqlite'; code?: string; message?: string }> {
  if (usePostgres && pgPool) {
    try {
      await ensurePgSchema();
      await pgPool.query('SELECT 1');
      return { ok: true, engine: 'postgresql' };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      return {
        ok: false,
        engine: 'postgresql',
        code: e?.code,
        message: (e?.message || String(err)).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]'),
      };
    }
  }
  try {
    const db = await getSqliteDb();
    db.prepare('SELECT 1').get();
    return { ok: true, engine: 'sqlite' };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { ok: false, engine: 'sqlite', code: e?.code, message: e?.message || String(err) };
  }
}

// Lazy SQLite fallback loader — only imported when PostgreSQL is not configured
// or during one-time legacy SQLite -> PostgreSQL migration.
let sqliteModulePromise: Promise<typeof import('node:sqlite')> | null = null;
function loadSqliteModule(): Promise<typeof import('node:sqlite')> {
  if (!sqliteModulePromise) {
    sqliteModulePromise = import('node:sqlite');
  }
  return sqliteModulePromise;
}

let sqliteDb: SqliteDatabaseSync | null = null;

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

function tryOpenSqlite(
  DatabaseSyncCtor: typeof import('node:sqlite').DatabaseSync,
  dbPath: string,
  journalMode: 'WAL' | 'DELETE'
): SqliteDatabaseSync {
  const db = new DatabaseSyncCtor(dbPath);
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

async function getSqliteDb(): Promise<SqliteDatabaseSync> {
  if (sqliteDb) {
    return sqliteDb;
  }
  const { DatabaseSync } = await loadSqliteModule();
  const candidates = resolveWritableDbCandidates();
  let lastError: unknown;
  for (const dbPath of candidates) {
    for (const mode of (dbPath === ':memory:' ? ['DELETE'] : ['WAL', 'DELETE']) as ('WAL' | 'DELETE')[]) {
      try {
        sqliteDb = tryOpenSqlite(DatabaseSync, dbPath, mode);
        return sqliteDb;
      } catch (err) {
        lastError = err;
        console.warn(`Gagal membuka SQLite (${dbPath}, mode ${mode}):`, err);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Gagal menginisialisasi database fallback lokal.');
}

function isSqliteBusyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; errcode?: number; message?: string };
  const msg = (e.message || '').toLowerCase();
  return (
    (e.code === 'ERR_SQLITE_ERROR' && (msg.includes('locked') || msg.includes('busy'))) ||
    msg.includes('database is locked') ||
    msg.includes('sqlite_busy')
  );
}

async function withSqliteRetry<T>(fn: (db: SqliteDatabaseSync) => T, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const db = await getSqliteDb();
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

function findExistingLegacySqlitePath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'data', 'candycbt-runtime.db'),
    path.join(os.tmpdir(), 'candycbt-data', 'candycbt-runtime.db'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
        return candidate;
      }
    } catch {
      // ignore inaccessible candidate
    }
  }
  return null;
}

async function readLegacySqliteSnapshot(): Promise<{
  docs: StoredDocRow[];
  sessionSecret?: string;
} | null> {
  const sqliteFile = findExistingLegacySqlitePath();
  if (!sqliteFile) return null;

  try {
    const { DatabaseSync } = await loadSqliteModule();
    const legacyDb = new DatabaseSync(sqliteFile, { readOnly: true });
    try {
      const hasDocsTable = legacyDb
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='cbt_docs'`)
        .get() as { name?: string } | undefined;
      if (!hasDocsTable?.name) {
        return null;
      }

      const rawDocs = legacyDb
        .prepare('SELECT collection, id, pos, data FROM cbt_docs ORDER BY collection, pos, id')
        .all() as { collection: string; id: string; pos: number; data: string }[];

      const docs: StoredDocRow[] = [];
      for (const row of rawDocs) {
        try {
          docs.push({
            collection: row.collection,
            id: row.id,
            pos: Number(row.pos),
            data: JSON.parse(row.data),
          });
        } catch {
          // skip malformed legacy row
        }
      }

      let sessionSecret: string | undefined;
      try {
        const secretRow = legacyDb
          .prepare(`SELECT value FROM cbt_meta WHERE key = 'session_secret'`)
          .get() as { value?: string } | undefined;
        sessionSecret = secretRow?.value;
      } catch {
        // ignore missing cbt_meta
      }

      return { docs, sessionSecret };
    } finally {
      legacyDb.close();
    }
  } catch (err) {
    console.warn('Melewati pembacaan migrasi SQLite lama:', err);
    return null;
  }
}

export async function dbInitSessionSecret(candidate: string): Promise<string> {
  if (usePostgres && pgPool) {
    return withPgRetry(async () => {
      await ensurePgSchema();
      const existing = await pgPool!.query<{ value: string }>(
        `SELECT value FROM cbt_meta WHERE key = 'session_secret'`
      );
      if (existing.rows[0]?.value) {
        return existing.rows[0].value;
      }

      let initialSecret = candidate;
      const legacy = await readLegacySqliteSnapshot();
      if (legacy?.sessionSecret && legacy.sessionSecret.length >= 16) {
        initialSecret = legacy.sessionSecret;
      }

      await pgPool!.query(
        `INSERT INTO cbt_meta (key, value) VALUES ('session_secret', $1) ON CONFLICT (key) DO NOTHING`,
        [initialSecret]
      );
      const { rows } = await pgPool!.query<{ value: string }>(
        `SELECT value FROM cbt_meta WHERE key = 'session_secret'`
      );
      return rows[0]?.value || initialSecret;
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

export async function dbGetDocsVersion(): Promise<number> {
  if (usePostgres && pgPool) {
    return withPgRetry(async () => {
      await ensurePgSchema();
      const { rows } = await pgPool!.query<{ value: string }>(
        `SELECT value FROM cbt_meta WHERE key = 'docs_version'`
      );
      return Number(rows[0]?.value || 0);
    });
  }
  return 0;
}

export async function dbLoadPresence(): Promise<{ students: number; staff: number }> {
  if (usePostgres && pgPool) {
    return withPgRetry(async () => {
      await ensurePgSchema();
      const { rows } = await pgPool!.query<{ role: string; n: number }>(
        `SELECT role, count(*)::int AS n FROM cbt_presence WHERE seen_at > now() - interval '75 seconds' GROUP BY role`
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
    const cutoff = Date.now() - 75_000;
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
  version: number;
}> {
  if (usePostgres && pgPool) {
    return withPgRetry(async () => {
      await ensurePgSchema();
      const [docsRes, presenceRes, versionRes] = await Promise.all([
        pgPool!.query<StoredDocRow>(
          'SELECT collection, id, pos, data FROM cbt_docs ORDER BY collection, pos, id'
        ),
        pgPool!.query<{ role: string; n: number }>(
          `SELECT role, count(*)::int AS n FROM cbt_presence WHERE seen_at > now() - interval '75 seconds' GROUP BY role`
        ),
        pgPool!.query<{ value: string }>(
          `SELECT value FROM cbt_meta WHERE key = 'docs_version'`
        ),
      ]);
      const presence = { students: 0, staff: 0 };
      for (const row of presenceRes.rows) {
        if (row.role === 'student') presence.students += row.n;
        else presence.staff += row.n;
      }
      let version = Number(versionRes.rows[0]?.value || 0);

      if (docsRes.rows.length === 0) {
        const legacy = await readLegacySqliteSnapshot();
        if (legacy && legacy.docs.length > 0) {
          await pgPool!.query(
            `INSERT INTO cbt_docs (collection, id, pos, data)
             SELECT x.collection, x.id, x.pos, x.data
             FROM jsonb_to_recordset($1::jsonb) AS x(collection text, id text, pos double precision, data jsonb)
             ON CONFLICT (collection, id) DO NOTHING`,
            [JSON.stringify(legacy.docs)]
          );
          const vBump = await pgPool!.query<{ value: string }>(
            `INSERT INTO cbt_meta (key, value) VALUES ('docs_version', '1')
             ON CONFLICT (key) DO UPDATE SET value = ((cbt_meta.value::bigint) + 1)::text
             RETURNING value`
          );
          version = Number(vBump.rows[0]?.value || 1);
          const migratedRes = await pgPool!.query<StoredDocRow>(
            'SELECT collection, id, pos, data FROM cbt_docs ORDER BY collection, pos, id'
          );
          return { docs: migratedRes.rows, presence, version };
        }
      }

      return { docs: docsRes.rows, presence, version };
    });
  }

  return withSqliteRetry((db) => {
    const docRows = db
      .prepare('SELECT collection, id, pos, data FROM cbt_docs ORDER BY collection, pos, id')
      .all() as { collection: string; id: string; pos: number; data: string }[];
    const cutoff = Date.now() - 75_000;
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

    return { docs, presence, version: 0 };
  });
}

export async function dbFlushChanges(
  upserts: StoredDocRow[],
  deletes: { collection: string; id: string }[],
  events: PendingEventWrite[]
): Promise<number | null> {
  if (usePostgres && pgPool) {
    return withPgRetry(async () => {
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
        let nextVersion: number | null = null;
        if (upserts.length > 0 || deletes.length > 0) {
          const vRes = await client.query<{ value: string }>(
            `INSERT INTO cbt_meta (key, value) VALUES ('docs_version', '1')
             ON CONFLICT (key) DO UPDATE SET value = ((cbt_meta.value::bigint) + 1)::text
             RETURNING value`
          );
          nextVersion = Number(vRes.rows[0]?.value || 1);
        }
        await client.query('COMMIT');
        return nextVersion;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    });
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
  return null;
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

  getSqliteDb()
    .then((db) => {
      const eventCutoff = Date.now() - 30 * 60 * 1000;
      const presenceCutoff = Date.now() - 5 * 60 * 1000;
      db.prepare(`DELETE FROM cbt_events WHERE created_at < ?`).run(eventCutoff);
      db.prepare(`DELETE FROM cbt_presence WHERE seen_at < ?`).run(presenceCutoff);
      try {
        db.exec(`PRAGMA wal_checkpoint(PASSIVE)`);
      } catch {
        // ignore when not in WAL mode
      }
    })
    .catch((err) => {
      console.error('Gagal membersihkan cbt_events:', err);
    });
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
  const res = await dbPollEventsAfter(afterId, audiences);
  return res.events;
}

export async function dbPollEventsAfter(
  afterId: number,
  audiences: string[]
): Promise<{ cursor: number; events: StoredEventRow[] }> {
  if (!Number.isFinite(afterId) || afterId < 0) {
    const maxId = await dbGetMaxEventId();
    return { cursor: maxId, events: [] };
  }

  if (audiences.length === 0) {
    return { cursor: afterId, events: [] };
  }

  if (usePostgres && pgPool) {
    return withPgRetry(async () => {
      await ensurePgSchema();
      const { rows } = await pgPool!.query<{
        max_id: string;
        id: string | null;
        event: string | null;
        payload: unknown;
      }>(
        `WITH latest AS (SELECT COALESCE(max(id), 0) AS max_id FROM cbt_events)
         SELECT l.max_id, e.id, e.event, e.payload
         FROM latest l
         LEFT JOIN LATERAL (
           SELECT id, event, payload
           FROM cbt_events
           WHERE id > $1 AND audience = ANY($2::text[])
           ORDER BY id ASC
           LIMIT 200
         ) e ON true
         ORDER BY e.id ASC NULLS LAST`,
        [afterId, audiences]
      );

      let cursor = afterId;
      const events: StoredEventRow[] = [];
      for (const r of rows) {
        cursor = Math.max(cursor, Number(r.max_id || 0));
        if (r.id !== null && r.event !== null) {
          const evId = Number(r.id);
          cursor = Math.max(cursor, evId);
          events.push({ id: evId, event: r.event, payload: r.payload });
        }
      }
      return { cursor, events };
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

    const maxRow = db.prepare('SELECT max(id) AS max FROM cbt_events').get() as
      | { max?: number | null }
      | undefined;

    let cursor = Math.max(afterId, Number(maxRow?.max || 0));
    const events = rows.map((r) => {
      let payload: unknown = null;
      if (r.payload) {
        try {
          payload = JSON.parse(r.payload);
        } catch {
          payload = null;
        }
      }
      const evId = Number(r.id);
      cursor = Math.max(cursor, evId);
      return {
        id: evId,
        event: r.event,
        payload,
      };
    });
    return { cursor, events };
  });
}
