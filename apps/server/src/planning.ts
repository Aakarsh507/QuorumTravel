import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient, User } from "@prisma/client";
import { z } from "zod";
import {
  preferenceInputSchema,
  solveGroupPlan,
  tallyStatus,
  voteInputSchema,
  type PlanResult,
  type PlanStatus,
  type Preference,
  type VoteChoice,
} from "@quorum/shared";
import { USER_HEADER, resolveUser } from "./auth";
import { getMembership, type Membership } from "./service";

/**
 * SYS-01 (trip setup + private preferences) and SYS-02 (group plan solver and
 * voting). Every trip route checks membership first. Other members'
 * preferences are never returned by any route (FR-103): readiness exposes only
 * "submitted yes/no", and the plan holds only aggregate results.
 */
export function registerPlanningRoutes(app: FastifyInstance, prisma: PrismaClient) {
  type TripReq = FastifyRequest<{ Params: { tripId: string } }>;

  async function currentUser(req: FastifyRequest, reply: FastifyReply): Promise<User | null> {
    const user = await resolveUser(prisma, req.headers[USER_HEADER] as string | undefined);
    if (!user) reply.code(401).send({ error: "Not signed in" });
    return user;
  }

  async function member(req: TripReq, reply: FastifyReply): Promise<{ user: User; m: Membership } | null> {
    const user = await currentUser(req, reply);
    if (!user) return null;
    const m = await getMembership(prisma, req.params.tripId, user.id);
    if (!m) {
      reply.code(403).send({ error: "You are not a member of this trip" });
      return null;
    }
    return { user, m };
  }

  /** Short status shown on the "Your trips" cards. */
  async function tripStatus(tripId: string, memberCount: number): Promise<{ label: string; tone: string }> {
    const plan = await prisma.groupPlan.findUnique({ where: { tripId } });
    if (plan?.status === "CONFIRMED") return { label: "Confirmed", tone: "good" };
    if (plan?.status === "PROPOSED") return { label: "Ready for group approval", tone: "info" };
    if (plan?.status === "REJECTED") return { label: "Plan rejected", tone: "warn" };
    if (plan?.status === "INFEASIBLE") {
      const r = JSON.parse(plan.result) as PlanResult;
      return { label: !r.feasible && r.conflict === "budget" ? "Budget conflict" : "Dates conflict", tone: "warn" };
    }
    const submitted = await prisma.preference.count({ where: { tripId } });
    return { label: `Collecting preferences (${submitted} of ${memberCount})`, tone: "neutral" };
  }

  // ---------------------------------------------------------------- trips

  app.get("/me/trips", async (req, reply) => {
    const user = await currentUser(req, reply);
    if (!user) return;
    const rows = await prisma.tripMember.findMany({
      where: { userId: user.id },
      include: { trip: { include: { _count: { select: { members: true } } } } },
      orderBy: { trip: { createdAt: "asc" } },
    });
    return Promise.all(
      rows.map(async (r) => ({
        id: r.tripId,
        name: r.trip.name,
        role: r.role,
        memberCount: r.trip._count.members,
        status: await tripStatus(r.tripId, r.trip._count.members),
      })),
    );
  });

  app.post("/trips", async (req, reply) => {
    const user = await currentUser(req, reply);
    if (!user) return;
    const body = z.object({ name: z.string().trim().min(1, "Give the trip a name").max(80) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]!.message });
    const trip = await prisma.trip.create({
      data: { name: body.data.name, members: { create: { userId: user.id, role: "CREATOR", canEdit: true } } },
    });
    return reply.code(201).send({ id: trip.id, name: trip.name, inviteCode: trip.inviteCode });
  });

  app.get("/trips/:tripId", async (req: TripReq, reply) => {
    const ctx = await member(req, reply);
    if (!ctx) return;
    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: req.params.tripId },
      include: { members: { include: { user: true } }, invites: { orderBy: { createdAt: "asc" } } },
    });
    return {
      id: trip.id,
      name: trip.name,
      inviteCode: trip.inviteCode,
      me: { userId: ctx.user.id, displayName: ctx.user.displayName, role: ctx.m.role },
      members: trip.members.map((x) => ({ userId: x.userId, displayName: x.user.displayName, role: x.role })),
      invites: trip.invites.map((i) => ({ email: i.email, status: "INVITED" as const })),
      status: await tripStatus(trip.id, trip.members.length),
    };
  });

  app.post("/trips/:tripId/invites", async (req: TripReq, reply) => {
    const ctx = await member(req, reply);
    if (!ctx) return;
    if (ctx.m.role !== "CREATOR") return reply.code(403).send({ error: "Only the trip creator can invite people" });
    const body = z
      .object({ emails: z.array(z.string().trim().toLowerCase().email("Enter a valid email address")).min(1).max(20) })
      .safeParse(req.body);
    if (!body.success) {
      const issue = body.error.issues[0]!;
      const raw = (req.body as { emails?: unknown[] } | undefined)?.emails?.[issue.path[1] as number];
      const error = issue.path[0] === "emails" && typeof raw === "string" ? `"${raw}" is not a valid email address` : issue.message;
      return reply.code(400).send({ error });
    }
    for (const email of body.data.emails) {
      await prisma.invite.upsert({
        where: { tripId_email: { tripId: req.params.tripId, email } },
        create: { tripId: req.params.tripId, email },
        update: {},
      });
    }
    const invites = await prisma.invite.findMany({ where: { tripId: req.params.tripId }, orderBy: { createdAt: "asc" } });
    return reply.code(201).send(invites.map((i) => ({ email: i.email, status: "INVITED" })));
  });

  /** Open the share link: the current user joins the trip as a member. */
  app.post<{ Params: { inviteCode: string } }>("/join/:inviteCode", async (req, reply) => {
    const user = await currentUser(req, reply);
    if (!user) return;
    const trip = await prisma.trip.findUnique({ where: { inviteCode: req.params.inviteCode } });
    if (!trip) return reply.code(404).send({ error: "This invite link is not valid" });
    await prisma.tripMember.upsert({
      where: { tripId_userId: { tripId: trip.id, userId: user.id } },
      create: { tripId: trip.id, userId: user.id },
      update: {},
    });
    return { tripId: trip.id, name: trip.name };
  });

  // ---------------------------------------------------------- preferences

  const toPreference = (row: { dateRanges: string; maxBudgetUsd: number; departureAirport: string; tags: string }): Preference => ({
    dateRanges: JSON.parse(row.dateRanges),
    maxBudgetUsd: row.maxBudgetUsd,
    departureAirport: row.departureAirport,
    tags: JSON.parse(row.tags),
  });

  // Only "/me": there is deliberately no route to read another member's preferences.
  app.get("/trips/:tripId/preferences/me", async (req: TripReq, reply) => {
    const ctx = await member(req, reply);
    if (!ctx) return;
    const row = await prisma.preference.findUnique({
      where: { tripId_userId: { tripId: req.params.tripId, userId: ctx.user.id } },
    });
    return { preference: row ? toPreference(row) : null };
  });

  app.put("/trips/:tripId/preferences/me", async (req: TripReq, reply) => {
    const ctx = await member(req, reply);
    if (!ctx) return;
    const parsed = preferenceInputSchema.safeParse(req.body);
    if (!parsed.success) {
      // FR-102: field-level errors, keyed by path ("maxBudgetUsd", "dateRanges.0.end", ...)
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) fields[i.path.join(".")] ??= i.message;
      return reply.code(400).send({ error: "Please fix the highlighted fields", fields });
    }
    const p = parsed.data;
    const data = {
      dateRanges: JSON.stringify(p.dateRanges),
      maxBudgetUsd: p.maxBudgetUsd,
      departureAirport: p.departureAirport,
      tags: JSON.stringify(p.tags),
    };
    await prisma.preference.upsert({
      where: { tripId_userId: { tripId: req.params.tripId, userId: ctx.user.id } },
      create: { tripId: req.params.tripId, userId: ctx.user.id, ...data },
      update: data,
    });
    return { preference: p };
  });

  // ------------------------------------------------------------- planning

  app.get("/trips/:tripId/readiness", async (req: TripReq, reply) => {
    const ctx = await member(req, reply);
    if (!ctx) return;
    const [members, prefs] = await Promise.all([
      prisma.tripMember.findMany({ where: { tripId: req.params.tripId }, include: { user: true } }),
      prisma.preference.findMany({ where: { tripId: req.params.tripId }, select: { userId: true } }),
    ]);
    const done = new Set(prefs.map((p) => p.userId));
    const ready = members.filter((m) => done.has(m.userId)).length;
    const minimum = Math.min(2, members.length);
    return {
      memberCount: members.length,
      readyCount: ready,
      members: members
        .map((m) => ({ userId: m.userId, displayName: m.user.displayName, role: m.role, submitted: done.has(m.userId) }))
        .sort((a, b) => Number(b.submitted) - Number(a.submitted) || a.displayName.localeCompare(b.displayName)),
      canGenerate: ctx.m.role === "CREATOR" && ready >= minimum,
      minimumToGenerate: minimum,
    };
  });

  async function planView(tripId: string, userId: string) {
    const plan = await prisma.groupPlan.findUnique({ where: { tripId }, include: { votes: true } });
    if (!plan) return { plan: null };
    const memberCount = await prisma.tripMember.count({ where: { tripId } });
    const approvals = plan.votes.filter((v) => v.choice === "APPROVE").length;
    const rejections = plan.votes.filter((v) => v.choice === "REJECT").length;
    return {
      plan: {
        id: plan.id,
        status: plan.status as PlanStatus,
        result: JSON.parse(plan.result) as PlanResult,
        createdAt: plan.createdAt.toISOString(),
        approvals,
        rejections,
        memberCount,
        needed: Math.floor(memberCount / 2) + 1,
        myVote: (plan.votes.find((v) => v.userId === userId)?.choice ?? null) as VoteChoice | null,
      },
    };
  }

  app.get("/trips/:tripId/plan", async (req: TripReq, reply) => {
    const ctx = await member(req, reply);
    if (!ctx) return;
    return planView(req.params.tripId, ctx.user.id);
  });

  /** FR-201 / FR-202: run the solver over everyone who has submitted. */
  app.post("/trips/:tripId/plan/generate", async (req: TripReq, reply) => {
    const ctx = await member(req, reply);
    if (!ctx) return;
    if (ctx.m.role !== "CREATOR") return reply.code(403).send({ error: "Only the trip creator can generate the group plan" });
    const [memberCount, rows] = await Promise.all([
      prisma.tripMember.count({ where: { tripId: req.params.tripId } }),
      prisma.preference.findMany({ where: { tripId: req.params.tripId } }),
    ]);
    if (rows.length < Math.min(2, memberCount))
      return reply.code(409).send({ error: "At least two travelers need to submit preferences first" });

    const result = solveGroupPlan(rows.map((r) => ({ memberId: r.userId, ...toPreference(r) })));
    await prisma.$transaction([
      prisma.groupPlan.deleteMany({ where: { tripId: req.params.tripId } }), // votes cascade
      prisma.groupPlan.create({
        data: {
          tripId: req.params.tripId,
          status: result.feasible ? "PROPOSED" : "INFEASIBLE",
          result: JSON.stringify(result),
          createdById: ctx.user.id,
        },
      }),
    ]);
    return reply.code(201).send(await planView(req.params.tripId, ctx.user.id));
  });

  /** FR-203: accept / reject; confirmed once more than half the members accept. */
  app.post("/trips/:tripId/plan/vote", async (req: TripReq, reply) => {
    const ctx = await member(req, reply);
    if (!ctx) return;
    const body = voteInputSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "choice must be APPROVE or REJECT" });
    const plan = await prisma.groupPlan.findUnique({ where: { tripId: req.params.tripId } });
    if (!plan) return reply.code(404).send({ error: "No plan has been generated yet" });
    if (plan.status !== "PROPOSED") return reply.code(409).send({ error: `Voting is closed: this plan is ${plan.status.toLowerCase()}` });

    await prisma.vote.upsert({
      where: { planId_userId: { planId: plan.id, userId: ctx.user.id } },
      create: { planId: plan.id, userId: ctx.user.id, choice: body.data.choice },
      update: { choice: body.data.choice },
    });
    const [votes, memberCount] = await Promise.all([
      prisma.vote.findMany({ where: { planId: plan.id } }),
      prisma.tripMember.count({ where: { tripId: req.params.tripId } }),
    ]);
    const status = tallyStatus(
      votes.filter((v) => v.choice === "APPROVE").length,
      votes.filter((v) => v.choice === "REJECT").length,
      memberCount,
    );
    if (status !== plan.status) await prisma.groupPlan.update({ where: { id: plan.id }, data: { status } });
    return planView(req.params.tripId, ctx.user.id);
  });
}
