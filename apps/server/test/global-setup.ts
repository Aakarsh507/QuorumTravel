import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Fresh throwaway SQLite file for every test run (never touches dev.db).
const prismaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "prisma");

export default function setup() {
  for (const f of ["test.db", "test.db-journal"]) rmSync(join(prismaDir, f), { force: true });
  execSync("npx prisma db push --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
}
