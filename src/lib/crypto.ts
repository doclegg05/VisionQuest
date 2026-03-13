import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const keyBase64 = process.env.API_KEY_ENCRYPTION_KEY;
  if (!keyBase64) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("API_KEY_ENCRYPTION_KEY environment variable is required in production");
    }
    // Dev-only fallback — 32 bytes base64-encoded
    return Buffer.from("dGhpcy1pcy1hLWRldi1vbmx5LWtleS0zMi1ieXRlcyE=", "base64").subarray(0, 32);
  }
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("API_KEY_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    encrypted.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
}

export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const [ivB64, encB64, tagB64] = ciphertext.split(":");
  if (!ivB64 || !encB64 || !tagB64) {
    throw new Error("Invalid encrypted value format");
  }

  const iv = Buffer.from(ivB64, "base64");
  const encrypted = Buffer.from(encB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}
