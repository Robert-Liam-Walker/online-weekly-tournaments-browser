import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET ?? (process.env.NODE_ENV === "production" ? required("JWT_SECRET") : "dev-only-secret-change-me"),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean),
  engineKind: (process.env.ENGINE_KIND ?? "stub") as "stub" | "wasm",
  /** Bootstrap admin: created (or promoted) at boot when both are set. */
  adminUsername: process.env.ADMIN_USERNAME ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  adminEmail: process.env.ADMIN_EMAIL ?? "",
  /** Scheduler cadence. Small so LOBBY/LIVE transitions land within seconds of the schedule. */
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS ?? 5000),
  isProduction: process.env.NODE_ENV === "production",
};
