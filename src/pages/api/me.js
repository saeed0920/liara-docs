import { requireAuth } from "@/lib/auth";

export default function handler(req, res) {
  if (!requireAuth(req, res)) return;
  res.json({ ok: true });
}
