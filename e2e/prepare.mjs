import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/server");
for (const f of ["e2e.db", "e2e.db-journal"]) rmSync(path.join(server, "prisma", f), { force: true });

const env = { ...process.env, DATABASE_URL: "file:./e2e.db" };
execSync("npm run db:push", { cwd: server, env, stdio: "inherit" });
execSync("npm run db:seed", { cwd: server, env, stdio: "inherit" });
