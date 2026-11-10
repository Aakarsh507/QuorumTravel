import type { PrismaClient, User } from "@prisma/client";

/**
 * DEV-ONLY STAND-IN for SYS-07 (authentication).
 *
 * The real login/session work (FR-701/FR-702) is a separate task. Everything
 * else in the server asks this module "who is the current user?", so replacing
 * the body of `resolveUser` with real session-cookie lookup is the only change
 * needed. Here the caller simply states its user id.
 */
export async function resolveUser(
  prisma: PrismaClient,
  claimedUserId: string | undefined,
): Promise<User | null> {
  if (!claimedUserId) return null;
  return prisma.user.findUnique({ where: { id: claimedUserId } });
}

export const USER_HEADER = "x-user-id";
