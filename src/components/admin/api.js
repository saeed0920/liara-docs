// Admin API client. Same-origin, cookie session.
async function req(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok)
    throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

export const api = {
  me: () => req("/api/me"),
  login: (username, password) =>
    req("/api/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => req("/api/logout", { method: "POST" }),
  stats: (days) => req(`/api/stats?days=${days}`),
  getConfig: () => req("/api/config"),
  putConfig: (data) => req("/api/config", { method: "PUT", body: JSON.stringify(data) }),
};
