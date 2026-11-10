import type { PrismaClient, ItineraryItem as DbItem } from "@prisma/client";
import { buildSnapshot, type ItineraryItem, type ItinerarySnapshot } from "@quorum/shared";

export interface Membership {
  tripId: string;
  userId: string;
  role: "CREATOR" | "MEMBER";
  canEdit: boolean;
}

export async function getMembership(
  prisma: PrismaClient,
  tripId: string,
  userId: string,
): Promise<Membership | null> {
  const m = await prisma.tripMember.findUnique({
    where: { tripId_userId: { tripId, userId } },
  });
  if (!m) return null;
  return { tripId, userId, role: m.role as Membership["role"], canEdit: m.canEdit };
}

/** Creator always manages; members only when the creator granted edit rights. */
export function canManage(m: Membership): boolean {
  return m.role === "CREATOR" || m.canEdit;
}

export function toItem(row: DbItem, names: Map<string, string>): ItineraryItem {
  return {
    id: row.id,
    tripId: row.tripId,
    type: row.type as ItineraryItem["type"],
    title: row.title,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    timezone: row.timezone,
    location: row.location,
    status: row.status as ItineraryItem["status"],
    version: row.version,
    participantIds: JSON.parse(row.participantIds) as string[],
    createdById: row.createdById,
    lastEditedById: row.lastEditedById,
    lastEditedByName: names.get(row.lastEditedById) ?? "Unknown",
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadSnapshot(prisma: PrismaClient, tripId: string): Promise<ItinerarySnapshot> {
  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    include: { items: true, members: { include: { user: true } } },
  });
  const names = new Map(trip.members.map((m) => [m.userId, m.user.displayName]));
  return buildSnapshot(
    tripId,
    trip.version,
    trip.items.map((r) => toItem(r, names)),
  );
}

export async function bumpVersion(prisma: PrismaClient, tripId: string): Promise<void> {
  await prisma.trip.update({ where: { id: tripId }, data: { version: { increment: 1 } } });
}
