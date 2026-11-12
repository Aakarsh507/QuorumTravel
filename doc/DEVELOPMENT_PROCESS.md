# Quorum — Development Process

Team 11 · ECE 49595 SD I · Aakarsh Gupta, Dylan Patel, Roshan Patel, Zachary Krause

This is the process we follow for every change to this repository. If the process stops working for us, we change this file through a pull request like any other change.

**Contents**

1. [Repository architecture](#1-repository-architecture)
2. [Branching and workflow model](#2-branching-and-workflow-model)
3. [Code development and review policy](#3-code-development-and-review-policy)
4. [Task tracking (GitHub Project)](#4-task-tracking-github-project)
5. [References](#5-references)

---

## 1. Repository architecture

Quorum is a **TypeScript monorepo** that uses **npm workspaces**. One `npm install` at the root installs everything. The web app and the server share one package of types and logic, so a rule such as "what counts as a valid budget" is written once and runs on both sides.

### 1.1 Tree

```
QuorumTravel/
├── .github/
│   ├── workflows/
│   │   └── ci.yml                  # CI: install, typecheck, test on every PR
│   └── pull_request_template.md    # checklist every PR must fill in
├── apps/
│   ├── server/                     # @quorum/server — the API
│   │   ├── prisma/
│   │   │   ├── schema.prisma       # database schema (single source of truth)
│   │   │   └── seed.ts             # demo data (npm run setup)
│   │   ├── src/
│   │   │   ├── main.ts             # entry point: starts Fastify on :3001
│   │   │   ├── app.ts              # app factory + itinerary routes (SYS-04)
│   │   │   ├── planning.ts         # trips, invites, preferences, plan, votes (SYS-01/02)
│   │   │   ├── service.ts          # shared DB helpers (membership, snapshots)
│   │   │   └── auth.ts             # who is the caller? (dev stand-in until SYS-07)
│   │   └── test/                   # Vitest API tests (throwaway test.db)
│   └── web/                        # @quorum/web — React single-page app
│       ├── index.html
│       └── src/
│           ├── main.tsx            # entry point + router
│           ├── api.ts              # typed fetch client for the server
│           ├── session.tsx         # current user (dev "Viewing as" switcher)
│           ├── components/         # layout pieces reused across pages
│           └── pages/              # one file per screen in the Figma flows
├── packages/
│   └── shared/                     # @quorum/shared — used by web AND server
│       └── src/
│           ├── index.ts            # itinerary types, validation, conflict logic
│           ├── planning.ts         # preference validation + group plan solver
│           ├── airports.ts         # bundled IATA airport list (FR-102)
│           └── *.test.ts           # unit tests
├── doc/                            # project documents (this file, SDP, plans)
├── package.json                    # workspace root + scripts
├── tsconfig.base.json              # compiler settings every package extends
└── README.md                       # setup and run instructions
```

### 1.2 What goes where

| Location | Holds | Rule |
|---|---|---|
| `apps/web` | Everything the browser runs: pages, components, styling | Never talks to the database. Only calls the server through `api.ts` |
| `apps/server` | HTTP and real-time API, database access, permission checks | Every route checks membership before reading or writing trip data |
| `apps/server/prisma` | Database schema and seed data | Schema changes go in the same PR as the code that needs them |
| `packages/shared` | Types, validation schemas, pure logic (solver, conflict detection) | No I/O, no React, no database. Everything here is unit tested |
| `doc/` | SDP, requirement plans, this process | Markdown preferred so diffs are reviewable |
| `.github/` | CI and PR template | Changes need the whole team's approval |

**Why this layout:** the SDP splits the product into systems (SYS-01 to SYS-10). Most systems need a shared rule (for example, a valid preference), a server route and a page. The three-package layout keeps those three parts apart. A reviewer can tell from the file path alone whether a change touches the UI, the API or the shared rules.

### 1.3 Naming conventions

- Files: `camelCase.ts` for modules, `PascalCase.tsx` for React components and pages.
- One page component per Figma screen group, named after the screen (`YourTripsPage.tsx`, `PreferencesPage.tsx`).
- Requirement IDs from the SDP (`FR-201`, `NFR-403`) appear in test names, so `npm test` output doubles as the requirement checklist.

---

## 2. Branching and workflow model

We use a **two-long-lived-branch model**. It is a simplified Git Flow: `main` + `dev` plus short-lived topic branches, with no separate release branches.

```
main   ●───────────────────────●──────────────────●        (tagged at each milestone)
        \                     /                  /
dev      ●───●───●───●───●───●───●───●───●───●──●          (integration)
              \     /   \       /     \     /
feat/...       ●───●     ●─────●       ●───●               (one task each)
```

### 2.1 Long-lived branches

| Branch | Purpose | Who merges into it | Protected |
|---|---|---|---|
| `main` | Stable, demo-ready code. What graders and demos run. Each milestone is tagged (`v0.1-prototype`, `v0.2-midterm`, …) | Only release PRs from `dev`, and hotfix PRs | Yes: no direct pushes, PR + CI + 2 approvals |
| `dev` | Integration branch. All finished work lands here first and must always build and pass tests | Feature / fix / docs PRs | Yes: no direct pushes, PR + CI + 1 approval |

### 2.2 Short-lived branches

- Every task on the GitHub Project gets **its own branch**, created from the latest `dev`.
- Branches live **inside the team repository**. **We do not fork**: each member creates and pushes their branches to `Aakarsh507/QuorumTravel`.
- A branch should live **no longer than one week**. Larger tasks are split into several PRs.
- The branch is deleted after its PR merges (GitHub does this automatically).

### 2.3 Branch naming convention

```
<type>/<system-id>-<short-description>
```

| Part | Allowed values | Example |
|---|---|---|
| `type` | `feat` (new behavior), `fix` (bug), `docs`, `test`, `refactor`, `chore` (tooling, deps) | `feat` |
| `system-id` | SDP system in lower case: `sys-01` … `sys-10`; `core` for cross-cutting work | `sys-02` |
| `short-description` | 2–5 words, lower-case, hyphens | `plan-voting` |

Examples: `feat/sys-01-preferences-form`, `feat/sys-02-plan-voting`, `fix/sys-04-conflict-badge`, `docs/core-dev-process`, `chore/core-ci-workflow`.

(`feat/itinerary` predates this convention and is kept as-is.)

### 2.4 Commit messages

We follow **Conventional Commits** and name the requirement when there is one:

```
feat(sys-02): mark plan confirmed on majority vote (FR-203)
fix(sys-01): reject unknown IATA codes on the server (FR-102)
docs(core): add branching model to development process
```

Commit early and often on your own branch. Each commit must be your own work under your own Git identity, so the history shows who did what.

### 2.5 Day-to-day flow

```bash
git switch dev && git pull                      # 1. start from fresh dev
git switch -c feat/sys-01-preferences-form      # 2. one branch per task
# ...code, commit...
npm run typecheck && npm test                   # 3. same checks CI runs
git push -u origin feat/sys-01-preferences-form # 4. push, open PR into dev
```

If `dev` has moved on while you work, run `git merge dev` into your branch (do not rebase a branch someone else has already reviewed).

### 2.6 Releases and hotfixes

- **Release:** at each milestone (assignment deadline, demo) one member opens a PR `dev → main`, titled `release: v0.X-<milestone>`. After it merges, that member tags the merge commit.
- **Hotfix:** a bug found on `main` gets `fix/<sys-id>-<desc>` branched **from `main`**, a PR into `main`, then the same branch is merged into `dev` so the fix is not lost.

---

## 3. Code development and review policy

### 3.1 Pull requests

| Rule | Detail |
|---|---|
| Everything goes through a PR | No direct pushes to `dev` or `main` (enforced by branch protection) |
| Target | Feature / fix / docs PRs → `dev`. Release PRs → `main` |
| Link the task | PR description says `Closes #<issue>` so the Project card moves to Done on merge |
| Template | Fill in every section of `.github/pull_request_template.md` (what, why, how tested, screenshots for UI) |
| Size | Aim for under ~400 changed lines (excluding lock files and seed data). Bigger work is split |
| Frequency | Each member opens **at least one PR per week** during active development. Open a **draft PR** early to get feedback |
| Merge method | **Squash and merge**, with a Conventional Commit title, so `dev` reads as one line per task |
| Who merges | The **author** merges after the requirements below are met |

### 3.2 Review and approval

| Target branch | Approvals needed | Reviewer |
|---|---|---|
| `dev` | **1** | Any teammate other than the author |
| `main` | **2** | Two teammates other than the author |
| `.github/` or `doc/DEVELOPMENT_PROCESS.md` changes | **All** other members | Whole team (process changes affect everyone) |

**Reviewer responsibilities**

- Review within **48 hours** of being requested. If you can't, say so in the PR so someone else picks it up.
- Pull the branch and run it for any UI change. Don't approve UI work from the diff alone.
- Check: does it meet the linked requirement; are there tests for it; does it keep private data private (FR-103); is the naming consistent with this document.
- Use GitHub's **Request changes** for anything that must be fixed before merging. Prefix optional suggestions with `nit:`.
- The author resolves every conversation (by fixing it or replying) before merging.

### 3.3 CI checks

`.github/workflows/ci.yml` runs on every push to a PR targeting `dev` or `main`, and on pushes to those branches:

1. `npm ci` (clean install from the lock file)
2. `prisma generate` (database client)
3. `npm run typecheck`: TypeScript strict mode across all three packages
4. `npm test`: shared unit tests and server API tests, including requirement tests (FR-101 … FR-405)

**A PR cannot merge while CI is red.** If CI fails for a reason unrelated to the PR, fix that in a separate `fix/` or `chore/` PR first.

### 3.4 Definition of done

A task is done when:

- [ ] The code is merged into `dev` through an approved PR with green CI
- [ ] New behavior has automated tests named after the requirement ID, or the PR explains why it can't be tested automatically
- [ ] UI work matches the Figma design closely enough that a reviewer signed off with a screenshot in the PR
- [ ] README / `doc/` are updated if setup or behavior changed
- [ ] The GitHub Project card is in **Done**

---

## 4. Task tracking (GitHub Project)

All work is tracked on the repository's **GitHub Project** board.

| Column | Meaning |
|---|---|
| Backlog | Known work, not yet scheduled |
| Ready | Scheduled for this week, clear enough to start |
| In progress | Assigned, branch exists |
| In review | PR open and review requested |
| Done | Merged into `dev` |

- One issue per task, assigned to **one** owner. Labels: system (`SYS-01` … `SYS-10`) and MoSCoW priority (`must`, `should`, `could`).
- Issue title format: `[SYS-02] Majority voting on proposed plan (FR-203)`.
- We review the board at the start of each team meeting and move cards before discussing anything else.

---

## 5. References

Repository structure

- npm Docs — *Workspaces*: https://docs.npmjs.com/cli/using-npm/workspaces
- monorepo.tools — *Monorepo explained* (why shared packages beat copy-paste): https://monorepo.tools/
- Vite — *Project structure / index.html as entry*: https://vite.dev/guide/#index-html-and-project-root
- Prisma — *Prisma schema* and *Seeding*: https://www.prisma.io/docs/orm/prisma-schema and https://www.prisma.io/docs/orm/prisma-migrate/workflows/seeding
- Fastify — *Getting started / plugins & encapsulation*: https://fastify.dev/docs/latest/Guides/Getting-Started/
- TypeScript — *Project references and tsconfig bases*: https://www.typescriptlang.org/tsconfig

Branching, commits and review

- V. Driessen — *A successful Git branching model* (Git Flow, basis for `main` + `dev`): https://nvie.com/posts/a-successful-git-branching-model/
- GitHub Docs — *GitHub flow*: https://docs.github.com/en/get-started/using-github/github-flow
- GitHub Docs — *About protected branches*: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- Conventional Commits 1.0.0: https://www.conventionalcommits.org/en/v1.0.0/
- Google Engineering Practices — *Code review developer guide*: https://google.github.io/eng-practices/review/
- GitHub Docs — *About GitHub Actions for CI*: https://docs.github.com/en/actions/about-github-actions/about-continuous-integration-with-github-actions
- GitHub Docs — *About Projects*: https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects
