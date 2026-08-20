import { login, seedAdmin, setSessionCookie } from "@/lib/auth";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  // Seed the admin on first login attempt (idempotent, no custom server needed).
  await seedAdmin();

  const { username, password } = req.body ?? {};
  if (!username || !password)
    return res.status(400).json({ error: "missing credentials" });

  const token = await login(username, password);
  if (!token) return res.status(401).json({ error: "invalid credentials" });

  setSessionCookie(res, token);
  res.json({ ok: true });
}
