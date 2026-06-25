// Thin React "auth shell" — a minimal UI whose only job is to exercise the real cookie/CSRF/
// refresh flow end-to-end in a browser: log in, show who you are, log out. No router, no
// styling system; deliberately bare. Real product UI is later-stage work.
import { useState } from "react";
import { api } from "./api.js";

export function App() {
  const [me, setMe] = useState<{ userId: string; role: string; tenantId: string } | null>(null);
  const [email, setEmail] = useState("admin@acme.test");
  const [password, setPassword] = useState("password123");
  const [err, setErr] = useState("");

  async function doLogin() {
    setErr("");
    const r = await api.login(email, password);
    if (!r.ok) { setErr("Login failed"); return; }
    const who = await api.me();
    setMe((await who.json()).data);
  }
  async function doLogout() { await api.logout(); setMe(null); }

  if (me) return (<div style={{ padding: 24 }}><h2>Signed in</h2><pre>{JSON.stringify(me, null, 2)}</pre><button onClick={doLogout}>Log out</button></div>);
  return (
    <div style={{ padding: 24, maxWidth: 320 }}>
      <h2>HotelSec login</h2>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" type="password" />
      <button onClick={doLogin}>Log in</button>
      {err && <p style={{ color: "red" }}>{err}</p>}
    </div>
  );
}
