import crypto from 'node:crypto';
import type { UserRole } from '../src/types/cbt.js';
import { ensureSchema, pool } from './db.js';

let sharedSecret: string | null = null;
let sharedSecretLoading: Promise<string> | null = null;

// Serverless instances do not share memory, so the token signing secret must be
// identical everywhere: use SESSION_SECRET when set, otherwise one stored in the database.
export function initSigningSecret(): Promise<string> {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    sharedSecret = envSecret;
    return Promise.resolve(envSecret);
  }
  if (sharedSecret) {
    return Promise.resolve(sharedSecret);
  }
  if (!sharedSecretLoading) {
    sharedSecretLoading = (async () => {
      await ensureSchema();
      const candidate = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `INSERT INTO cbt_meta (key, value) VALUES ('session_secret', $1) ON CONFLICT (key) DO NOTHING`,
        [candidate]
      );
      const { rows } = await pool.query<{ value: string }>(
        `SELECT value FROM cbt_meta WHERE key = 'session_secret'`
      );
      sharedSecret = rows[0]?.value || candidate;
      return sharedSecret;
    })().catch((err) => {
      sharedSecretLoading = null;
      throw err;
    });
  }
  return sharedSecretLoading;
}

function getSigningSecret(): string {
  if (!sharedSecret) {
    throw new Error('Signing secret belum dimuat. Panggil initSigningSecret() terlebih dahulu.');
  }
  return sharedSecret;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPasswordHash(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) {
    return false;
  }
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const keyBuf = Buffer.from(keyHex, 'hex');
    if (derived.length !== keyBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(derived, keyBuf);
  } catch {
    return false;
  }
}

export function verifyEnvPasscode(input: string, envPasscode: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(envPasscode);
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export interface TokenPayload {
  sub: string;
  role: UserRole;
  name: string;
  identifier: string;
  exp: number;
}

export function signAuthToken(payload: Omit<TokenPayload, 'exp'>, ttlHours = 12): string {
  const fullPayload: TokenPayload = {
    ...payload,
    exp: Date.now() + ttlHours * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyAuthToken(token: string): TokenPayload | null {
  if (!token || !token.includes('.')) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) {
    return null;
  }
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');

  const sigBufA = Buffer.from(providedSig);
  const sigBufB = Buffer.from(expectedSig);
  if (sigBufA.length !== sigBufB.length || !crypto.timingSafeEqual(sigBufA, sigBufB)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
