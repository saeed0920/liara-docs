const mode = process.argv[2];
if (!["runtime", "migration"].includes(mode)) throw new Error("usage: validate-deployment-env.mjs runtime|migration");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function versioned(prefix, versionName) {
  const version = required(versionName);
  if (!/^[1-9]\d*$/u.test(version)) throw new Error(`${versionName} must be a positive integer`);
  required(`${prefix}${version}`);
}

required("DATABASE_URL");

if (mode === "runtime") {
  versioned("ENCRYPTION_KEY_V", "ENCRYPTION_KEY_CURRENT_VERSION");
  versioned("ASSISTANT_HMAC_KEY_V", "ASSISTANT_HMAC_KEY_CURRENT_VERSION");
  for (const name of [
    "SESSION_SECRET",
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD",
    "ENGINE_URL",
    "ENGINE_API_TOKEN",
    "AVALAI_ALLOWED_HOSTS",
    "ASSISTANT_ALLOWED_HOSTS",
    "ASSISTANT_ALLOWED_ORIGINS",
    "TRUSTED_CLIENT_IP_HEADER",
  ]) required(name);

  const engine = new URL(process.env.ENGINE_URL);
  if (!["http:", "https:"].includes(engine.protocol) || engine.username || engine.password || engine.search || engine.hash) {
    throw new Error("ENGINE_URL must be a credential-free internal HTTP(S) origin");
  }
  if (process.env.ENGINE_API_TOKEN.length < 32) throw new Error("ENGINE_API_TOKEN must be at least 32 characters");
  const trustedHeader = process.env.TRUSTED_CLIENT_IP_HEADER.toLowerCase();
  if (!/^[a-z0-9-]+$/u.test(trustedHeader) || ["x-forwarded-for", "forwarded", "x-real-ip"].includes(trustedHeader)) {
    throw new Error("TRUSTED_CLIENT_IP_HEADER must be the explicit Liara-approved non-forwarded client-IP header");
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("NEXT_PUBLIC_") && /(secret|token|key|password|credential|authorization)/iu.test(name) && value) {
      throw new Error(`${name} must not expose a secret`);
    }
  }
}

console.log(`deployment environment valid for ${mode}`);
