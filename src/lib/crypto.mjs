import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function parseVersion(value, name) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw new Error(`${name} must be a positive integer`);
  return version;
}

function decodeKey(hex, name) {
  if (!/^[a-f0-9]{64}$/i.test(hex ?? "")) throw new Error(`${name} must be 32-byte hex (64 chars)`);
  return Buffer.from(hex, "hex");
}

function keyring(env = process.env) {
  const legacy = env.ENCRYPTION_SECRET;
  const currentVersion = parseVersion(env.ENCRYPTION_KEY_CURRENT_VERSION ?? "1", "ENCRYPTION_KEY_CURRENT_VERSION");
  const keys = new Map();
  if (legacy) keys.set(1, decodeKey(legacy, "ENCRYPTION_SECRET"));
  for (const [name, value] of Object.entries(env)) {
    const match = name.match(/^ENCRYPTION_KEY_V([1-9]\d*)$/);
    if (match && value) keys.set(Number(match[1]), decodeKey(value, name));
  }
  if (!keys.has(currentVersion)) throw new Error(`ENCRYPTION_KEY_V${currentVersion} is required`);
  return { currentVersion, keys };
}

export function currentEncryptionVersion(env = process.env) {
  return keyring(env).currentVersion;
}

export function encrypt(plain, env = process.env) {
  if (typeof plain !== "string" || !plain) throw new Error("plaintext is required");
  const { currentVersion, keys } = keyring(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.get(currentVersion), iv);
  cipher.setAAD(Buffer.from(`assistant-key:v${currentVersion}`));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v${currentVersion}:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}

export function envelopeVersion(blob) {
  const match = /^v([1-9]\d*):/.exec(blob ?? "");
  return match ? Number(match[1]) : 1;
}

export function decrypt(blob, env = process.env) {
  const parts = String(blob ?? "").split(":");
  const versioned = /^v[1-9]\d*$/.test(parts[0]);
  const version = versioned ? Number(parts.shift().slice(1)) : 1;
  if (parts.length !== 3) throw new Error("invalid encrypted envelope");
  const { keys } = keyring(env);
  const key = keys.get(version);
  if (!key) throw new Error(`encryption key version ${version} is unavailable`);
  const [ivText, tagText, encryptedText] = parts;
  const iv = Buffer.from(ivText, "base64");
  const tag = Buffer.from(tagText, "base64");
  if (iv.length !== 12 || tag.length !== 16 || !encryptedText) throw new Error("invalid encrypted envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (versioned) decipher.setAAD(Buffer.from(`assistant-key:v${version}`));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64")), decipher.final()]).toString("utf8");
}

export function reencrypt(blob, env = process.env) {
  return encrypt(decrypt(blob, env), env);
}

export async function migrateAvalaiKeyEnvelope({ db, env = process.env }) {
  const config = await db.config.findUnique({ where: { id: 1 } });
  if (!config?.avalaiKeyEnc || envelopeVersion(config.avalaiKeyEnc) === currentEncryptionVersion(env)) return false;
  const migrated = reencrypt(config.avalaiKeyEnc, env);
  await db.config.update({
    where: { id: 1 },
    data: { avalaiKeyEnc: migrated, avalaiKeyVersion: currentEncryptionVersion(env) },
  });
  return true;
}
