import { PrismaClient } from "@prisma/client";
import { DESTINATIONS, solveGroupPlan, type Preference } from "@quorum/shared";

/**
 * Seeds the SDP FR-401 fixture: 2 flights, 1 lodging, 3 activities (+ one
 * proposed activity and one deliberate overlap so the UI shows both states).
 * Trip: "Lisbon Getaway" with a creator and three members.
 */
export async function seed(prisma: PrismaClient) {
  await prisma.itineraryItem.deleteMany();
  await prisma.tripMember.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();

  const [ada, ben, cy, dee] = await Promise.all(
    ["Ada (creator)", "Ben", "Cy", "Dee"].map((displayName) => prisma.user.create({ data: { displayName } })),
  );
  const trip = await prisma.trip.create({ data: { name: "Lisbon Getaway" } });
  await prisma.tripMember.createMany({
    data: [
      { tripId: trip.id, userId: ada!.id, role: "CREATOR", canEdit: true },
      { tripId: trip.id, userId: ben!.id, role: "MEMBER", canEdit: true }, // authorised by creator
      { tripId: trip.id, userId: cy!.id, role: "MEMBER" },
      { tripId: trip.id, userId: dee!.id, role: "MEMBER" },
    ],
  });

  const base = { tripId: trip.id, createdById: ada!.id, lastEditedById: ada!.id };
  const d = (s: string) => new Date(s);
  await prisma.itineraryItem.createMany({
    data: [
      { ...base, type: "FLIGHT", title: "IND → LIS (outbound)", location: "Indianapolis Intl", timezone: "America/Indiana/Indianapolis", startAt: d("2027-06-01T21:30:00Z"), endAt: d("2027-06-02T08:40:00Z"), status: "CONFIRMED" },
      { ...base, type: "LODGING", title: "Alfama Apartment", location: "Rua de São Miguel, Lisbon", timezone: "Europe/Lisbon", startAt: d("2027-06-02T14:00:00Z"), endAt: d("2027-06-07T10:00:00Z"), status: "CONFIRMED" },
      { ...base, type: "ACTIVITY", title: "Walking tour of Alfama", location: "Alfama", timezone: "Europe/Lisbon", startAt: d("2027-06-03T09:00:00Z"), endAt: d("2027-06-03T11:30:00Z"), status: "CONFIRMED" },
      { ...base, type: "ACTIVITY", title: "Belém Tower & pastries", location: "Belém", timezone: "Europe/Lisbon", startAt: d("2027-06-04T10:00:00Z"), endAt: d("2027-06-04T13:00:00Z"), status: "CONFIRMED" },
      { ...base, type: "ACTIVITY", title: "Sintra day trip", location: "Sintra", timezone: "Europe/Lisbon", startAt: d("2027-06-05T08:00:00Z"), endAt: d("2027-06-05T16:00:00Z"), status: "CONFIRMED" },
      { ...base, type: "FLIGHT", title: "LIS → IND (return)", location: "Humberto Delgado", timezone: "Europe/Lisbon", startAt: d("2027-06-07T12:15:00Z"), endAt: d("2027-06-07T22:50:00Z"), status: "CONFIRMED" },
      // overlaps "Sintra day trip" for everyone -> conflict badges
      { ...base, createdById: cy!.id, lastEditedById: cy!.id, type: "ACTIVITY", title: "Fado dinner (proposed)", location: "Bairro Alto", timezone: "Europe/Lisbon", startAt: d("2027-06-05T14:00:00Z"), endAt: d("2027-06-05T17:00:00Z"), status: "PROPOSED" },
    ],
  });
  return { tripId: trip.id, users: { ada: ada!.id, ben: ben!.id, cy: cy!.id, dee: dee!.id } };
}

/**
 * Seeds Workflow 1 (Design A: Group Trip Planning) demo data for SYS-01/02.
 * Alex is the creator of three trips, matching the "Your trips" Figma frame:
 *  - Miami Spring Break 2027: 2 of 5 preferences in (Alex submits live in the demo)
 *  - Nashville Reunion: plan confirmed by majority vote
 *  - Asheville Weekend: nobody's dates overlap -> "Dates conflict"
 */
export async function seedPlanning(prisma: PrismaClient) {
  const names = ["Alex Rivera", "Maya Chen", "Jordan Lee", "Sam Patel", "Priya Nair"];
  const [alex, maya, jordan, sam, priya] = await Promise.all(
    names.map((displayName) => prisma.user.create({ data: { displayName } })),
  );
  const ids = { alex: alex!.id, maya: maya!.id, jordan: jordan!.id, sam: sam!.id, priya: priya!.id };

  async function trip(name: string, memberIds: string[]) {
    const t = await prisma.trip.create({ data: { name } });
    await prisma.tripMember.createMany({
      data: memberIds.map((userId, i) => ({ tripId: t.id, userId, role: i === 0 ? "CREATOR" : "MEMBER", canEdit: i === 0 })),
    });
    return t.id;
  }
  async function prefer(tripId: string, userId: string, p: Preference) {
    await prisma.preference.create({
      data: {
        tripId,
        userId,
        dateRanges: JSON.stringify(p.dateRanges),
        maxBudgetUsd: p.maxBudgetUsd,
        departureAirport: p.departureAirport,
        tags: JSON.stringify(p.tags),
      },
    });
    return { memberId: userId, ...p };
  }

  // 1. Miami Spring Break 2027 — collecting preferences
  const miami = await trip("Miami Spring Break 2027", [ids.alex, ids.maya, ids.jordan, ids.sam, ids.priya]);
  await prefer(miami, ids.maya, { dateRanges: [{ start: "2027-03-10", end: "2027-03-20" }], maxBudgetUsd: 1600, departureAirport: "ORD", tags: ["beach", "nightlife", "food"] });
  await prefer(miami, ids.jordan, { dateRanges: [{ start: "2027-03-12", end: "2027-03-19" }], maxBudgetUsd: 1400, departureAirport: "IND", tags: ["beach", "food", "culture"] });

  // 2. Nashville Reunion — confirmed (3 of 4 approved)
  const nash = await trip("Nashville Reunion", [ids.alex, ids.maya, ids.sam, ids.priya]);
  const nashPrefs = [
    await prefer(nash, ids.alex, { dateRanges: [{ start: "2027-05-21", end: "2027-05-26" }], maxBudgetUsd: 1200, departureAirport: "IND", tags: ["nightlife", "food"] }),
    await prefer(nash, ids.maya, { dateRanges: [{ start: "2027-05-20", end: "2027-05-25" }], maxBudgetUsd: 1300, departureAirport: "ORD", tags: ["culture", "food"] }),
    await prefer(nash, ids.sam, { dateRanges: [{ start: "2027-05-21", end: "2027-05-28" }], maxBudgetUsd: 1100, departureAirport: "CVG", tags: ["nightlife"] }),
    await prefer(nash, ids.priya, { dateRanges: [{ start: "2027-05-19", end: "2027-05-25" }], maxBudgetUsd: 1500, departureAirport: "ATL", tags: ["food", "city"] }),
  ];
  const nashPlan = await prisma.groupPlan.create({
    data: {
      tripId: nash,
      status: "CONFIRMED",
      createdById: ids.alex,
      result: JSON.stringify(solveGroupPlan(nashPrefs, DESTINATIONS.filter((d) => d.airport === "BNA"))),
    },
  });
  await prisma.vote.createMany({
    data: [ids.alex, ids.maya, ids.priya].map((userId) => ({ planId: nashPlan.id, userId, choice: "APPROVE" })),
  });

  // 3. Asheville Weekend — dates never overlap for everyone
  const ash = await trip("Asheville Weekend", [ids.alex, ids.jordan, ids.priya]);
  const ashPrefs = [
    await prefer(ash, ids.alex, { dateRanges: [{ start: "2027-04-09", end: "2027-04-11" }], maxBudgetUsd: 900, departureAirport: "IND", tags: ["outdoors", "food"] }),
    await prefer(ash, ids.jordan, { dateRanges: [{ start: "2027-04-10", end: "2027-04-12" }], maxBudgetUsd: 800, departureAirport: "IND", tags: ["outdoors"] }),
    await prefer(ash, ids.priya, { dateRanges: [{ start: "2027-04-16", end: "2027-04-18" }], maxBudgetUsd: 1000, departureAirport: "ATL", tags: ["culture"] }),
  ];
  await prisma.groupPlan.create({
    data: {
      tripId: ash,
      status: "INFEASIBLE",
      createdById: ids.alex,
      result: JSON.stringify(solveGroupPlan(ashPrefs, DESTINATIONS.filter((d) => d.airport === "AVL"))),
    },
  });

  return { trips: { miami, nash, ash }, users: ids };
}

// run directly (`npm run db:seed`), not when imported by tests
if (process.argv[1]?.endsWith("seed.ts")) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then(async (r) => {
      const p = await seedPlanning(prisma);
      console.log("Seeded itinerary trip", r.tripId, "and planning trips", Object.values(p.trips).join(", "));
    })
    .finally(() => prisma.$disconnect());
}
