import { useCallback, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { LobbyEventUpdate, WeeklyEventDto } from "@owt/shared";
import { api, SOCKET_URL } from "../lib/api";

/**
 * The current event plus live registration/presence counts. Updates arrive over
 * the /lobby socket and are backed by a slow poll, so a dropped socket can never
 * leave the page stuck on a stale status.
 */
export function useNextEvent() {
  const [event, setEvent] = useState<WeeklyEventDto | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ event: WeeklyEventDto | null }>("/events/next");
      setEvent(r.event);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setEvent((cur) => cur ?? null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    let s: Socket | null = null;
    try {
      s = io(`${SOCKET_URL ?? ""}/lobby`, { transports: ["websocket"] });
      s.on("lobby:event", (u: LobbyEventUpdate) => {
        setEvent((cur) => (cur && cur.id === u.eventId ? { ...cur, status: u.status as WeeklyEventDto["status"], registered: u.registered, checkedIn: u.present } : cur));
        void refresh(); // status changes can move scheduledAt too (forced starts)
      });
      s.on("connect", () => void refresh());
    } catch { /* offline */ }
    return () => { s?.disconnect(); };
  }, [refresh]);

  return { event, error, refresh, setEvent };
}
