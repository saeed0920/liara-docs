import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const k = Buffer.from(process.env.ENCRYPTION_SECRET ?? "", "hex");
  if (k.length !== 32) {
    throw new Error("ENCRYPTION_SECRET must be 32-byte hex (64 chars)");
  }
  return k;
}

// Returns "iv:tag:cipher", all base64.
export function encrypt(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decrypt(blob) {
  const [iv, tag, enc] = blob.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return (
    decipher.update(Buffer.from(enc, "base64")).toString("utf8") +
    decipher.final("utf8")
  );
}
