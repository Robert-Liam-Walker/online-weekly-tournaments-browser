import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { USERNAME_REGEX } from "@owt/shared";
import { prisma } from "../lib/prisma.js";

const registerBody = z.object({
  username: z.string().regex(USERNAME_REGEX, "3 to 16 letters, digits or underscores"),
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
});

const loginBody = z.object({
  identifier: z.string().min(1).max(254), // username or email
  password: z.string().min(1).max(200),
});

// Per-IP cap on sign-up/sign-in. Raise it locally (AUTH_RATE_LIMIT) to run the bot load test.
const strict = { rateLimit: { max: Number(process.env.AUTH_RATE_LIMIT ?? 20), timeWindow: "1 minute" } };

export async function authRoutes(app: FastifyInstance) {
  app.post("/register", { config: strict }, async (request, reply) => {
    const parsed = registerBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const { username, email, password } = parsed.data;

    const clash = await prisma.user.findFirst({
      where: { OR: [{ username: { equals: username, mode: "insensitive" } }, { email: { equals: email, mode: "insensitive" } }] },
      select: { username: true },
    });
    if (clash) return reply.code(409).send({ error: clash.username.toLowerCase() === username.toLowerCase() ? "Username taken" : "Email already registered" });

    const user = await prisma.user.create({
      data: { username, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10) },
    });
    const token = app.jwt.sign({ id: user.id, username: user.username, role: user.role });
    return { token, user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt.toISOString() } };
  });

  app.post("/login", { config: strict }, async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const { identifier, password } = parsed.data;
    const user = await prisma.user.findFirst({
      where: { OR: [{ username: { equals: identifier, mode: "insensitive" } }, { email: { equals: identifier.toLowerCase() } }] },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return reply.code(401).send({ error: "Wrong username or password" });
    const token = app.jwt.sign({ id: user.id, username: user.username, role: user.role });
    return { token, user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt.toISOString() } };
  });

  app.get("/me", { preHandler: app.authenticate }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.id } });
    if (!user) return reply.code(401).send({ error: "Account no longer exists" });
    return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt.toISOString() };
  });
}
