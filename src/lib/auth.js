import jwt from "jsonwebtoken";
import argon2 from "argon2";
import { db } from "./db.js";

const COOKIE = "admin_session";
const MAX_AGE = 60 * 60 * 12; // 12h

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET missing");
  return s;
}

// Create seed admin if none exists. Idempotent.
export async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) throw new Error("ADMIN_USERNAME/PASSWORD missing");
  const existing = await db.admin.findUnique({ where: { username } });
  if (existing) return;
  await db.admin.create({
    data: { username, passwordHash: await argon2.hash(password) },
  });
}

export async function login(username, password) {
  const admin = await db.admin.findUnique({ where: { username } });
  if (!admin || !(await argon2.verify(admin.passwordHash, password))) return null;
  return jwt.sign({ sub: admin.id }, secret(), { expiresIn: "12h" });
}

function serializeCookie(value, maxAge) {
  const parts = [
    `${COOKIE}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", serializeCookie(token, MAX_AGE));
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", serializeCookie("", 0));
}

// Verify session from a Next API request. Returns admin id or null.
export function getSession(req) {
  const raw = req.headers.cookie ?? "";
  const match = raw.split(/; */).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  const token = match.slice(COOKIE.length + 1);
  try {
    return jwt.verify(token, secret()).sub;
  } catch {
    return null;
  }
}

// Guard helper for API routes. Returns true if request is authenticated,
// otherwise writes 401 and returns false.
export function requireAuth(req, res) {
  if (getSession(req)) return true;
  res.status(401).json({ error: "unauthorized" });
  return false;
}
