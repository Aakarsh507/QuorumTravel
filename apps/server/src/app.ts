import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { Server as IoServer } from "socket.io";
import type { PrismaClient, User } from "@prisma/client";
import { z } from "zod";
import {
  SOCKET_EVENTS,
  itemInputSchema,
  itemPatchSchema,
  type ItineraryItem,
} from "@quorum/shared";
import { USER_HEADER, resolveUser } from "./auth";
import {
  bumpVersion,
  canManage,
  getMembership,
  loadSnapshot,
  toItem,
  type Membership,
} from "./service";

export interface AppOptions {
  prisma: PrismaClient;
  webOrigin?: string;
  enableDevRoutes?: boolean;
}

const room = (tripId: string) => `trip:${tripId}`;

export async function createApp({ prisma, webOrigin = "http://localhost:5173", enableDevRoutes = true }: AppOptions) {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: webOrigin });

  const io = new IoServer(app.server, { cors: { origin: webOrigin } });

  async function broadcast(tripId: string) {
    io.to(room(tripId)).emit(SOCKET_EVENTS.snapshot, await loadSnapshot(prisma, tripId));
  }

  // ---- socket: only verified trip members may join the room (access control)
  io.use(async (socket, next) => {
    const { userId, tripId } = socket.handshake.auth as { userId?: string; tripId?: string };
    const user = await resolveUser(prisma, userId);
    if (!user || !tripId) return next(new Error("unauthorized"));
    const m = await getMembership(prisma, tripId, user.id);
    if (!m) return next(new Error("forbidden"));
    socket.data.tripId = tripId;
    next();
  });
  io.on("connection", async (socket) => {
    const tripId = socket.data.tripId as string;
    await socket.join(room(tripId));
    // send current state right away so a (re)connecting client is never stale
    socket.emit(SOCKET_EVENTS.snapshot, await loadSnapshot(prisma, tripId));
  });

  // ---- request guard: current user + trip membership
  async function guard(
    req: FastifyRequest<{ Params: { tripId: string } }>,
    reply: FastifyReply,
  ): Promise<{ user: User; m: Membership } | null> {
    const user = await resolveUser(prisma, req.headers[USER_HEADER] as string | undefined);
    if (!user) {
      reply.code(401).send({ error: "Not signed in" });
      return null;
    }
    const m = await getMembership(prisma, req.params.tripId, user.id);
    if (!m) {
      reply.code(403).send({ error: "You are not a member of this trip" });
      return null;
    }
    return { user, m };
  }

  async function memberIds(tripId: string): Promise<Set<string>> {
    const rows = await prisma.tripMember.findMany({ where: { tripId } });
    return new Set(rows.map((r) => r.userId));
  }

  type TripReq = FastifyRequest<{ Params: { tripId: string } }>;

  // ---- dev helpers (user switcher for the stand-in auth)
  if (enableDevRoutes) {
    app.get("/dev/users", async () => {
      const users = await prisma.user.findMany({
        include: { memberships: { include: { trip: true } } },
        orderBy: { displayName: "asc" },
      });
      return users.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        trips: u.memberships.map((m) => ({ id: m.tripId, name: m.trip.name, role: m.role })),
      }));
    });
  }

  // ---- read
  app.get("/trips/:tripId/itinerary", async (req: TripReq, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: req.params.tripId },
      include: { members: { include: { user: true } } },
    });
    return {
      snapshot: await loadSnapshot(prisma, req.params.tripId),
      me: { userId: ctx.user.id, role: ctx.m.role, canEdit: ctx.m.canEdit, canManage: canManage(ctx.m) },
      members: trip.members.map((x) => ({
        userId: x.userId,
        displayName: x.user.displayName,
        role: x.role,
        canEdit: x.canEdit,
      })),
    };
  });

  // ---- create (managers confirm directly; everyone else proposes)
  app.post("/trips/:tripId/items", async (req: TripReq, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const parsed = itemInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid item", issues: parsed.error.flatten() });
    const input = parsed.data;
    const ids = await memberIds(req.params.tripId);
    if (input.participantIds.some((p) => !ids.has(p)))
      return reply.code(400).send({ error: "participantIds must be trip members" });

    const row = await prisma.itineraryItem.create({
      data: {
        tripId: req.params.tripId,
        type: input.type,
        title: input.title,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        timezone: input.timezone,
        location: input.location,
        status: canManage(ctx.m) ? "CONFIRMED" : "PROPOSED",
        participantIds: JSON.stringify(input.participantIds),
        createdById: ctx.user.id,
        lastEditedById: ctx.user.id,
      },
    });
    await bumpVersion(prisma, req.params.tripId);
    await broadcast(req.params.tripId);
    return reply.code(201).send(toItem(row, new Map([[ctx.user.id, ctx.user.displayName]])));
  });

  // ---- update (optimistic concurrency -> 409)
  app.patch<{ Params: { tripId: string; itemId: string } }>(
    "/trips/:tripId/items/:itemId",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      const parsed = itemPatchSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid patch", issues: parsed.error.flatten() });
      const { expectedVersion, ...changes } = parsed.data;

      const existing = await prisma.itineraryItem.findFirst({
        where: { id: req.params.itemId, tripId: req.params.tripId },
      });
      if (!existing) return reply.code(404).send({ error: "Item not found" });

      const manager = canManage(ctx.m);
      const ownProposal = existing.createdById === ctx.user.id && existing.status === "PROPOSED";
      if (!manager && !ownProposal)
        return reply.code(403).send({ error: "Only the trip creator (or members they authorise) can edit this item" });
      if (!manager && changes.status && changes.status !== "PROPOSED")
        return reply.code(403).send({ error: "Only a manager can confirm items" });

      if (changes.participantIds) {
        const ids = await memberIds(req.params.tripId);
        if (changes.participantIds.some((p) => !ids.has(p)))
          return reply.code(400).send({ error: "participantIds must be trip members" });
      }
      const start = changes.startAt ?? existing.startAt.toISOString();
      const end = changes.endAt ?? existing.endAt.toISOString();
      if (Date.parse(end) <= Date.parse(start))
        return reply.code(400).send({ error: "End must be after start" });

      // atomic compare-and-set on version: a stale edit never overwrites
      const res = await prisma.itineraryItem.updateMany({
        where: { id: existing.id, version: expectedVersion },
        data: {
          ...(changes.type && { type: changes.type }),
          ...(changes.title && { title: changes.title }),
          ...(changes.startAt && { startAt: new Date(changes.startAt) }),
          ...(changes.endAt && { endAt: new Date(changes.endAt) }),
          ...(changes.timezone && { timezone: changes.timezone }),
          ...(changes.location !== undefined && { location: changes.location }),
          ...(changes.participantIds && { participantIds: JSON.stringify(changes.participantIds) }),
          ...(changes.status && { status: changes.status }),
          lastEditedById: ctx.user.id,
          version: { increment: 1 },
        },
      });
      if (res.count === 0) {
        const current = await prisma.itineraryItem.findUnique({ where: { id: existing.id } });
        return reply.code(409).send({
          error: "This item was changed by someone else. Reload and try again.",
          currentVersion: current?.version ?? null,
        });
      }
      await bumpVersion(prisma, req.params.tripId);
      await broadcast(req.params.tripId);
      const updated = await prisma.itineraryItem.findUniqueOrThrow({ where: { id: existing.id } });
      return toItem(updated, new Map([[ctx.user.id, ctx.user.displayName]]));
    },
  );

  // ---- delete
  app.delete<{ Params: { tripId: string; itemId: string } }>(
    "/trips/:tripId/items/:itemId",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      const existing = await prisma.itineraryItem.findFirst({
        where: { id: req.params.itemId, tripId: req.params.tripId },
      });
      if (!existing) return reply.code(404).send({ error: "Item not found" });
      const ownProposal = existing.createdById === ctx.user.id && existing.status === "PROPOSED";
      if (!canManage(ctx.m) && !ownProposal)
        return reply.code(403).send({ error: "Only the trip creator (or members they authorise) can delete this item" });
      await prisma.itineraryItem.delete({ where: { id: existing.id } });
      await bumpVersion(prisma, req.params.tripId);
      await broadcast(req.params.tripId);
      return reply.code(204).send();
    },
  );

  // ---- creator grants / revokes edit permission
  app.patch<{ Params: { tripId: string; userId: string } }>(
    "/trips/:tripId/members/:userId",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      if (ctx.m.role !== "CREATOR")
        return reply.code(403).send({ error: "Only the trip creator can change permissions" });
      const body = z.object({ canEdit: z.boolean() }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "canEdit (boolean) required" });
      const target = await getMembership(prisma, req.params.tripId, req.params.userId);
      if (!target) return reply.code(404).send({ error: "Member not found" });
      if (target.role === "CREATOR")
        return reply.code(400).send({ error: "The creator always has edit rights" });
      await prisma.tripMember.update({
        where: { tripId_userId: { tripId: req.params.tripId, userId: req.params.userId } },
        data: { canEdit: body.data.canEdit },
      });
      return { userId: req.params.userId, canEdit: body.data.canEdit };
    },
  );

  return {
    app,
    io,
    async close() {
      await io.close();
      await app.close();
    },
  };
}

export type { ItineraryItem };
