import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Login() {
  const login = useAuth((s) => s.login);
  const nav = useNavigate();
  const loc = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(identifier.trim(), password); nav((loc.state as { from?: string } | null)?.from ?? "/arena"); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-md">
      <p className="kicker">Welcome back</p>
      <h1 className="mt-2 text-3xl font-bold">Sign in</h1>
      <form onSubmit={submit} className="card mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="identifier">Username or email</label>
          <input id="identifier" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button className="btn-gold w-full" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        <p className="text-center text-sm text-slate-400">New here? <Link to="/signup" className="text-gold-300">Create an account</Link></p>
      </form>
    </div>
  );
}
