import { clearSessionCookie } from "@/lib/auth";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  clearSessionCookie(res);
  res.json({ ok: true });
}
