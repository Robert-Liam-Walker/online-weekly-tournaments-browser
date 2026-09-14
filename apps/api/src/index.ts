import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import authPlugin from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { eventRoutes } from "./routes/events.js";
import { resultRoutes } from "./routes/results.js";
import { TournamentManager } from "./tournament/TournamentManager.js";
import { attachSockets } from "./tournament/socket.js";
import { startScheduler } from "./scheduler.js";

async function bootstrapAdmin(): Promise<void> {
  if (!config.adminUsername || !config.adminPassword) return;
  const passwordHash = await bcrypt.hash(config.adminPassword, 10);
  const email = config.adminEmail || `${config.adminUsername.toLowerCase()}@admin.local`;
  await prisma.user.upsert({
    where: { username: config.adminUsername },
    create: { username: config.adminUsername, email, passwordHash, role: "ADMIN" },
    update: { role: "ADMIN" },
  });
}

async function main() {
  const app = Fastify({ logger: { level: config.isProduction ? "info" : "debug" }, trustProxy: true });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(authPlugin);

  let lobbyRef: { broadcast(eventId: string): Promise<void>; bracketChanged(eventId: string): void } | null = null;
  const tm = new TournamentManager(
    config.engineKind,
    async (eventId) => { await lobbyRef?.broadcast(eventId); },
    (eventId) => lobbyRef?.bracketChanged(eventId),
  );
  const { lobby } = attachSockets(app, app.server, tm, config.corsOrigins);
  lobbyRef = lobby;

  app.get("/api/health", async () => ({ ok: true, engine: config.engineKind, time: new Date().toISOString() }));
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(async (sub) => eventRoutes(sub, { tm, lobby }), { prefix: "/api/events" });
  await app.register(resultRoutes, { prefix: "/api" });

  await bootstrapAdmin();
  tm.start();
  const stopScheduler = startScheduler(tm, (id) => lobby.broadcast(id), config.schedulerIntervalMs);

  const shutdown = async () => {
    stopScheduler();
    tm.stop();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
