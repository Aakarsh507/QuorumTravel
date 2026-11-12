import { PrismaClient } from "@prisma/client";

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

// run directly (`npm run db:seed`), not when imported by tests
if (process.argv[1]?.endsWith("seed.ts")) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then((r) => console.log("Seeded trip", r.tripId))
    .finally(() => prisma.$disconnect());
}
