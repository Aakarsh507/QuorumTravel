import { PrismaClient } from "@prisma/client";
import { createApp } from "./app";

const prisma = new PrismaClient();
const port = Number(process.env.PORT ?? 3001);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";

const { app } = await createApp({
  prisma,
  webOrigin,
  enableDevRoutes: process.env.NODE_ENV !== "production",
});
await app.listen({ port, host: "0.0.0.0" });
console.log(`Quorum server listening on http://localhost:${port}`);
