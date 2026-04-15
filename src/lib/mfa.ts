import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { encrypt, decrypt } from "./crypto";

// --- Base32 encoding/decoding (RFC 4648) ---

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BACKUP_CODE_RE = /^[a-f0-9]{8}$/;

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let result = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

// --- TOTP implementation (RFC 6238 / RFC 4226) ---

function generateTotpCode(secret: Buffer, counter: bigint): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(counter);

  const hmac = createHmac("sha1", secret).update(buffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return code.toString().padStart(6, "0");
}

/**
 * Verify a TOTP token against a secret, allowing a configurable time window.
 * Window of 1 means we check the current period, one before, and one after (90s total).
 * Returns the matching counter value on success, or null on failure.
 */
function verifyTotpRaw(secret: Buffer, token: string, window: number = 1): number | null {
  if (!/^\d{6}$/.test(token)) {
    return null;
  }

  const timeStep = 30;
  const currentCounter = BigInt(Math.floor(Date.now() / 1000 / timeStep));

  for (let i = -window; i <= window; i++) {
    const counter = currentCounter + BigInt(i);
    const expected = generateTotpCode(secret, counter);

    // Constant-time comparison to prevent timing attacks
    let match = true;
    for (let j = 0; j < 6; j++) {
      if (expected[j] !== token[j]) {
        match = false;
      }
    }
    if (match) {
      return Number(counter);
    }
  }

  return null;
}

// --- Public API ---

/**
 * Generate a new TOTP secret (20 bytes = 160 bits, standard for SHA-1 TOTP).
 * Returns the base32-encoded plaintext secret and its encrypted form for DB storage.
 */
export function generateMfaSecret(): { secret: string; encrypted: string } {
  const raw = randomBytes(20);
  const secret = base32Encode(raw);
  const encrypted = encrypt(secret);
  return { secret, encrypted };
}

/**
 * Generate a TOTP URI for authenticator apps (Google Authenticator, Authy, 1Password, etc.).
 */
export function generateTotpUri(secret: string, email: string): string {
  return `otpauth://totp/VisionQuest:${encodeURIComponent(email)}?secret=${secret}&issuer=VisionQuest&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Verify a 6-digit TOTP token against an encrypted secret from the database.
 * Accepts an optional lastUsedCounter to reject replayed tokens.
 */
export function verifyTotp(
  encryptedSecret: string,
  token: string,
  lastUsedCounter?: number | null,
): { valid: boolean; counter: number | null } {
  const secret = decrypt(encryptedSecret);
  const keyBuffer = base32Decode(secret);
  const matchedCounter = verifyTotpRaw(keyBuffer, token);

  if (matchedCounter === null) {
    return { valid: false, counter: null };
  }

  // Reject replay: if this counter was already used, deny it
  if (lastUsedCounter != null && matchedCounter <= lastUsedCounter) {
    return { valid: false, counter: null };
  }

  return { valid: true, counter: matchedCounter };
}

/**
 * Generate 8 backup codes (8 hex characters each) for account recovery.
 * These should be displayed once to the user and stored hashed.
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    codes.push(randomBytes(4).toString("hex"));
  }
  return codes;
}

export function normalizeBackupCode(token: string): string {
  return token.trim().toLowerCase().replace(/[^a-f0-9]/g, "");
}

export function hashBackupCode(code: string): string {
  return createHash("sha256").update(normalizeBackupCode(code)).digest("hex");
}

export function hashBackupCodes(codes: string[]): string[] {
  return codes.map(hashBackupCode);
}

export function consumeBackupCode(
  storedHashes: string[],
  candidate: string,
): string[] | null {
  const normalized = normalizeBackupCode(candidate);
  if (!BACKUP_CODE_RE.test(normalized)) {
    return null;
  }

  const candidateHash = hashBackupCode(normalized);
  const candidateBuffer = Buffer.from(candidateHash);

  for (const [index, storedHash] of storedHashes.entries()) {
    if (storedHash.length !== candidateHash.length) {
      continue;
    }
    if (timingSafeEqual(Buffer.from(storedHash), candidateBuffer)) {
      return storedHashes.filter((_, currentIndex) => currentIndex !== index);
    }
  }

  return null;
}
