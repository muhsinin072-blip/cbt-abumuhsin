import crypto from 'node:crypto';
import type { UserRole } from '../src/types/cbt.ts';
import { dbInitSessionSecret, dbReadLocalSessionSecret, getIsUsingPostgres } from './db.ts';

let sharedSecret: string | null = null;
let sharedSecretLoading: Promise<string> | null = null;
const verificationSecrets = new Set<string>();

function deriveRuntimeSigningSecret(): string | null {
  const secretInputs = [
    process.env.DATABASE_URL?.trim(),
    process.env.POSTGRES_URL?.trim(),
    process.env.POSTGRES_URL_NON_POOLING?.trim(),
    process.env.ADMIN_PASSCODE?.trim(),
    process.env.GEMINI_API_KEY?.trim(),
  ].filter((v): v is string => Boolean(v && v.length >= 6));

  if (secretInputs.length === 0) {
    return null;
  }

  const deploymentScope = process.env.APPLET_ID?.trim() || 'candycbt';
  return crypto
    .createHmac('sha256', secretInputs.join('\n'))
    .update(`candycbt-session-signing-v1:${deploymentScope}`)
    .digest('hex');
}

function registerVerificationSecret(secret?: string | null): void {
  if (secret && secret.length >= 16) {
    verificationSecrets.add(secret);
  }
}

// Serverless/multi-instance containers do not share memory, so the token signing secret
// must match everywhere: prefer SESSION_SECRET, then PostgreSQL cbt_meta, then a key
// derived from server-only runtime secrets (process.env) when running on local failover,
// and finally a persisted SQLite random secret on standalone local setups.
export function initSigningSecret(): Promise<string> {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    sharedSecret = envSecret;
    registerVerificationSecret(envSecret);
    return Promise.resolve(envSecret);
  }
  if (sharedSecret) {
    return Promise.resolve(sharedSecret);
  }
  if (!sharedSecretLoading) {
    sharedSecretLoading = (async () => {
      const derived = deriveRuntimeSigningSecret();
      registerVerificationSecret(derived);

      const candidate = derived || crypto.randomBytes(32).toString('hex');
      const dbSecret = await dbInitSessionSecret(candidate);
      registerVerificationSecret(dbSecret);

      if (!getIsUsingPostgres()) {
        const localSecret = await dbReadLocalSessionSecret();
        registerVerificationSecret(localSecret);
      }

      // When PostgreSQL is unavailable/failed-over across multi-instance containers,
      // prefer the deterministic runtime-derived secret so every instance verifies tokens identically,
      // while keeping any previously stored local dbSecret in verificationSecrets for continuity.
      if (!getIsUsingPostgres() && derived) {
        sharedSecret = derived;
      } else {
        sharedSecret = dbSecret;
      }
      registerVerificationSecret(sharedSecret);
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

export function signAuthToken(payload: Omit<TokenPayload, 'exp'>, ttlHours = 24): string {
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

const SLIDING_REFRESH_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export function refreshAuthTokenIfNeeded(payload: TokenPayload): string | null {
  if (payload.exp - Date.now() > SLIDING_REFRESH_THRESHOLD_MS) {
    return null;
  }
  return signAuthToken({
    sub: payload.sub,
    role: payload.role,
    name: payload.name,
    identifier: payload.identifier,
  });
}

function signatureMatchesSecret(encoded: string, providedSig: string, secret: string): boolean {
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url');
  const sigBufA = Buffer.from(providedSig);
  const sigBufB = Buffer.from(expectedSig);
  return sigBufA.length === sigBufB.length && crypto.timingSafeEqual(sigBufA, sigBufB);
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

  const primary = getSigningSecret();
  let signatureValid = signatureMatchesSecret(encoded, providedSig, primary);
  if (!signatureValid) {
    for (const altSecret of verificationSecrets) {
      if (altSecret !== primary && signatureMatchesSecret(encoded, providedSig, altSecret)) {
        signatureValid = true;
        break;
      }
    }
  }
  if (!signatureValid) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (
      !parsed ||
      typeof parsed.sub !== 'string' ||
      !parsed.sub ||
      typeof parsed.role !== 'string' ||
      typeof parsed.exp !== 'number' ||
      parsed.exp < Date.now()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
