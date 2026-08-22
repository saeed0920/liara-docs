import { isIP } from "node:net";

export function trustedClientIp(headers, env = process.env) {
  const name = env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!name || !/^[a-z0-9-]+$/.test(name)) throw new Error("TRUSTED_CLIENT_IP_HEADER is required");
  const value = typeof headers.get === "function" ? headers.get(name) : headers[name];
  const ip = Array.isArray(value) ? value[0] : value;
  if (typeof ip === "string" && ip === ip.trim() && !ip.includes(",") && isIP(ip)) return ip;
  // ponytail: no edge proxy locally, fall back to loopback so dev works without Liara in front. Prod always has the header.
  if (env.NODE_ENV !== "production") return "127.0.0.1";
  throw new Error("trusted client IP is missing or invalid");
}
