import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-1.5 text-sm font-medium transition ${isActive ? "text-gold-300" : "text-slate-300 hover:text-white"}`;

export default function Nav() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  return (
    <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link to="/" className="mr-2 flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded border-2 border-gold-400 text-[12px] font-bold text-gold-400">W</span>
          <span className="hidden text-sm font-bold tracking-wide sm:block">Online Weekly Tournament Series</span>
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          <NavLink to="/arena" className={link}>Arena</NavLink>
          <NavLink to="/events" className={link}>Events</NavLink>
          <NavLink to="/leaderboard" className={link}>Leaderboard</NavLink>
          <NavLink to="/rules" className={link}>Rules</NavLink>
          <NavLink to="/about" className={link}>About</NavLink>
          {user?.role === "ADMIN" && <NavLink to="/admin" className={link}>Admin</NavLink>}
        </nav>
        {user ? (
          <div className="flex items-center gap-2">
            <Link to={`/players/${user.username}`} className="text-sm font-semibold text-gold-300">{user.username}</Link>
            <button className="btn-ghost !px-3 !py-1" onClick={logout}>Sign out</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link to="/login" className="btn-ghost !px-3 !py-1">Sign in</Link>
            <Link to="/signup" className="btn-gold !px-3 !py-1">Sign up</Link>
          </div>
        )}
      </div>
    </header>
  );
}
