// API DTOs shared by apps/api and apps/web.
import type { GameRecord } from "./set.js";

export type UserRole = "USER" | "ADMIN";
export type EventStatus = "SCHEDULED" | "LOBBY" | "LIVE" | "COMPLETE" | "CANCELLED";

export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

export interface WeeklyEventDto {
  id: string;
  title: string;
  scheduledAt: string;
  status: EventStatus;
  registered: number;
  checkedIn: number;
  isRegistered?: boolean;
  entrants?: number;
}

export interface BracketPlayerDto {
  userId: string;
  username: string;
  seed: number;
}

export interface BracketMatchDto {
  key: string;
  side: "W" | "L" | "GF" | "GFR";
  round: number;
  matchNumber: number;
  format: "BO3" | "BO5";
  p1: string | null | undefined;   // user id; null = bye; undefined = TBD
  p2: string | null | undefined;
  winnerId: string | null;
  score: [number, number];
  games: GameRecord[];
  done: boolean;
  cancelled: boolean;
  live: boolean;
  forfeit: boolean;
}

export interface BracketDto {
  eventId: string;
  size: number;
  players: BracketPlayerDto[];
  matches: BracketMatchDto[];
  champion: string | null;
}

export interface PlacementDto {
  userId: string;
  username: string;
  place: number;
  setsWon: number;
  setsLost: number;
  points: number;
}

export interface LeaderboardRow {
  userId: string;
  username: string;
  points: number;
  events: number;
  wins: number;
  bestPlace: number;
}

export const USERNAME_REGEX = /^[A-Za-z0-9_]{3,16}$/;
