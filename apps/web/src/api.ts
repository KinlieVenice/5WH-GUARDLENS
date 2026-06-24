function readCookie(name: string): string | null {
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1] ?? null;
}
async function call(path: string, method: "GET" | "POST", body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (method !== "GET") { const csrf = readCookie("hs_csrf"); if (csrf) headers["x-csrf-token"] = csrf; }
  let res = await fetch(`/api${path}`, { method, headers, credentials: "include", body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && path !== "/auth/refresh") {
    const r = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    if (r.ok) res = await fetch(`/api${path}`, { method, headers, credentials: "include", body: body ? JSON.stringify(body) : undefined });
  }
  return res;
}
export const api = {
  login: (email: string, password: string) => call("/auth/login", "POST", { email, password }),
  me: () => call("/auth/me", "GET"),
  logout: () => call("/auth/logout", "POST"),
};
