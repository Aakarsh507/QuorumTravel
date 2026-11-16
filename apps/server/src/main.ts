import { PrismaClient } from "@prisma/client";
import { createApp } from "./app";
import { flightProviderFromEnv } from "./flights";

// Load apps/server/.env (DUFFEL_TOKEN etc.). Prisma reads DATABASE_URL itself; nothing else did.
try {
  process.loadEnvFile();
} catch {
  // no .env file: fall back to the defaults below
}

const prisma = new PrismaClient();
const port = Number(process.env.PORT ?? 3001);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const flightProvider = flightProviderFromEnv();

const { app } = await createApp({
  prisma,
  webOrigin,
  enableDevRoutes: process.env.NODE_ENV !== "production",
  flightProvider,
});
await app.listen({ port, host: "0.0.0.0" });
console.log(`Quorum server listening on http://localhost:${port}`);
console.log(`Flight search: ${flightProvider.source === "duffel" ? "Duffel (DUFFEL_TOKEN set)" : "sample data (no DUFFEL_TOKEN)"}`);
