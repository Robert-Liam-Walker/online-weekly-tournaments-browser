import { create } from "zustand";
import type { PublicUser } from "@owt/shared";
import { api, getToken, setToken } from "./api";

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  hydrate: () => Promise<void>;
  signup: (username: string, email: string, password: string) => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  hydrate: async () => {
    if (!getToken()) { set({ loading: false }); return; }
    try {
      const user = await api<PublicUser>("/auth/me");
      set({ user, loading: false });
    } catch {
      setToken(null);
      set({ user: null, loading: false });
    }
  },
  signup: async (username, email, password) => {
    const r = await api<{ token: string; user: PublicUser }>("/auth/register", { method: "POST", json: { username, email, password } });
    setToken(r.token);
    set({ user: r.user });
  },
  login: async (identifier, password) => {
    const r = await api<{ token: string; user: PublicUser }>("/auth/login", { method: "POST", json: { identifier, password } });
    setToken(r.token);
    set({ user: r.user });
  },
  logout: () => { setToken(null); set({ user: null }); },
}));
