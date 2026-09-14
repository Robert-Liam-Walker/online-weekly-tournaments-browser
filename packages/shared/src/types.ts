// API DTOs shared by apps/api and apps/web.

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
}

export interface PlacementDto {
  userId: string;
  username: string;
  roomIndex: number;
  place: number;
  kos: number;
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
