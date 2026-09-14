import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import { useAuth } from "./lib/auth";
import Landing from "./pages/Landing";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import Arena from "./pages/Arena";
import Results from "./pages/Results";
import Leaderboard from "./pages/Leaderboard";
import Player from "./pages/Player";
import Rules from "./pages/Rules";
import About from "./pages/About";
import Admin from "./pages/Admin";
import Events from "./pages/Events";

function RequireAuth({ children }: { children: JSX.Element }) {
  const user = useAuth((s) => s.user);
  const loading = useAuth((s) => s.loading);
  const loc = useLocation();
  if (loading) return <div className="p-10 text-center text-slate-400">Loading...</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

export default function App() {
  const hydrate = useAuth((s) => s.hydrate);
  useEffect(() => { void hydrate(); }, [hydrate]);
  const loc = useLocation();
  const fullBleed = loc.pathname === "/arena";
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className={fullBleed ? "flex-1" : "mx-auto w-full max-w-6xl flex-1 px-4 py-8"}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/arena" element={<RequireAuth><Arena /></RequireAuth>} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/:id" element={<Results />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/players/:username" element={<Player />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/about" element={<About />} />
          <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!fullBleed && <Footer />}
    </div>
  );
}
