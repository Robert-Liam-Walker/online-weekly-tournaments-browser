import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Signup() {
  const signup = useAuth((s) => s.signup);
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await signup(username.trim(), email.trim(), password); nav("/arena"); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-md">
      <p className="kicker">Create account</p>
      <h1 className="mt-2 text-3xl font-bold">Sign up</h1>
      <p className="mt-1 text-slate-400">Free. Your username is what the other 99 fighters see.</p>
      <form onSubmit={submit} className="card mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="username">Username</label>
          <input id="username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required pattern="[A-Za-z0-9_]{3,16}" title="3 to 16 letters, digits or underscores" />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button className="btn-gold w-full" disabled={busy}>{busy ? "Creating..." : "Create account"}</button>
        <p className="text-center text-sm text-slate-400">Already have one? <Link to="/login" className="text-gold-300">Sign in</Link></p>
      </form>
    </div>
  );
}
