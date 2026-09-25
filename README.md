# Quant Academy

Interview preparation for quant trading and research roles: guided lessons, then timed practice on
generated problems, scored by your weakest area. This repository is the application; the curriculum
(skill graph, item templates, learning paths) lives in
[Quant-Academy-Curriculum-](https://github.com/neumannsfeli/Quant-Academy-Curriculum-), checked out next to it.

The two specs in this repository are the source of truth:

- `Quant Academy — Product Spec v1 (GTM).md` — what the product does and why (scoring model §4–7, sessions §10, lessons §19).
- `Quant Academy — Technical Design Spec v1.md` — how it is built.
- `AUTHORING.md` — the template and lesson format content authors write.

The UI follows the Figma file (37 frames); design tokens are generated from its variables (`packages/tokens`).

## Layout

| Path | What it is |
| --- | --- |
| `packages/scoring` | Pure scoring model: θ updates, levels, retention, readiness, replay. No I/O. |
| `packages/items` | Expression language, seeded PRNG, template → instance, numeric/MCQ checking, seed sweep. No I/O. |
| `packages/learning` | Lesson format, completion rules, entry band, validation. No I/O. |
| `packages/db` | Drizzle schema, SQL migrations (incl. append-only triggers), content seed. |
| `packages/core` | Server domain services: session runner, lessons, read models, admin, jobs, mail, rate limits. |
| `packages/tokens` | CSS variables and Tailwind theme generated from the Figma variables. |
| `apps/web` | Next.js 15 app: learner UI, admin console, route handlers, Auth.js (email link + Google). |
| `apps/grader` | FastAPI + SymPy service for symbolic answers (restricted parser, time-boxed simplify). |
| `apps/jobs` | Scheduled job handler (Lambda/SQS-shaped) and a local runner. |

`pnpm lint:boundaries` keeps the pure packages free of I/O imports.

## Running locally

Prerequisites: Node 22, pnpm 10, Python 3.11+, PostgreSQL 16.

```bash
# 1. The curriculum, next to this repository, built into one bundle
git clone <curriculum repo> ../Quant-Academy-Curriculum-
python3 ../Quant-Academy-Curriculum-/tools/build.py      # writes dist/content.json (validate.py runs as part of CI)

# 2. Dependencies
pnpm install
python3 -m venv apps/grader/.venv && apps/grader/.venv/bin/pip install -r apps/grader/requirements-dev.txt

# 3. Configuration — one .env at the repository root is read by web, jobs and the db scripts
cp .env.example .env

# 4. Database
createuser -s qa && psql -c "alter user qa password 'qa'" && createdb -O qa quant_academy
pnpm db:migrate && pnpm db:seed

# 5. Run (three terminals)
pnpm grader           # :8001
pnpm dev              # :3000
pnpm jobs schedule    # optional: sweeper, snapshots, emails, stats rollup on their production cadence
```

Sign up at http://localhost:3000/signup. In development the mailer writes to `apps/web/.mail/`; open
http://localhost:3000/dev/mailbox to click the sign-in link. Google sign-in appears when
`AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set.

To use the admin console (`/admin`), give yourself a staff role:

```sql
update users set role = 'admin' where email = 'you@example.com';   -- or 'author' / 'reviewer'
```

`SERVE_UNREVIEWED_CONTENT=true` serves templates that are still `in_review`, which is every template
until a reviewer promotes it. Production leaves it unset and serves `live` templates only.

Run a single job: `pnpm jobs once snapshots --force` (jobs: sweeper, snapshots, daily-plan,
weekly-summary, outcome-ask, stats-rollup, cleanup).

## Tests

```bash
createdb -O qa quant_academy_test
pnpm test                                   # scoring, items, learning, core (core uses quant_academy_test)
(cd apps/grader && .venv/bin/python -m pytest)
pnpm typecheck && pnpm lint:boundaries
```

The core tests reset `quant_academy_test` and seed it from the curriculum bundle
(`CONTENT_BUNDLE`, default `../Quant-Academy-Curriculum-/dist/content.json`).

## Deployment

`infra/quant-academy.yaml` is a CloudFormation template for the launch size: one Graviton
instance running the web app, grader, jobs scheduler, Postgres and Caddy under Docker Compose,
at roughly $15 a month. Merges to `main` build the images in GitHub Actions and roll the
instance. Setup, costs, operations and the path to the tech spec's larger options are in
[deploy/README.md](deploy/README.md).
