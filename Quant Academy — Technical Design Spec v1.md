# Quant Academy — Technical Design Spec v1

Sep 16, 2026 · Companion to the Product Spec and the Figma UI spec

## 1. Purpose

Three documents, one system:

- **UI spec** (Figma) — what it looks like, every screen and state.
- **Product spec** — what the numbers mean and how they move. All formulas, constants and rules live there and are referenced here by section, never restated.
- **This document** — how it is built.

Sections 2 to 13 are **identical regardless of which backend you choose**. They describe the application, the data model, the algorithms' placement, the API and the operational requirements.

Sections 14 and 15 give two AWS deployments of that same system:

|  | Option A — Lean | Option B — Robust |
| --- | --- | --- |
| Sized for | \~100 users, launch | thousands, growth |
| Monthly cost | **\~$45** | **\~$650** |
| Availability target | 99.5% | 99.9% |
| Ops burden | hours per month | a person's part-time job |

The application code is **the same in both**. §16 covers choosing, and the small number of things that must be right on day one so that A → B is a deployment change rather than a rewrite.

## 2. Principles and hard constraints

Six constraints drive most of what follows. They come from the product, not from taste.

**1. The response log is the asset.** Append-only, never updated in place, rich enough to replay every derived number from scratch. If a bug corrupts `user_skill_state`, it must be rebuildable. Product spec §3.5.

**2. Scoring is a pure function.** No I/O, no ambient clock, no randomness. The same module serves live traffic, the θ-replay job after an item is voided, and the test suite. If scoring reaches into the database, replay becomes a second implementation that drifts.

**3. The server owns the clock and the answer.** Timing is measured server-side; correct answers, solutions and misconception text are never in a payload sent before submission. Product spec §9.

**4. Item generation is deterministic.** `(template_id, version, seed)` reproduces an instance exactly, forever. The database stores a seed, not a rendered question, and a reviewer investigating a flag sees precisely what the user saw.

**5. Grading failure must never cost a user.** If the grader is slow or down, the item is voided and requeued — never marked wrong. Product spec §8.1.3.

**6. Stateless application processes.** No local disk state, no in-memory session affinity, no cron running inside the web container. This is what makes Option A → Option B a configuration change.

### Non-goals for v1

Multi-region, offline support, real-time collaboration, mobile app, background media processing, and anything that requires a message broker for correctness rather than convenience.

## 3. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript, strict | One language across UI, API, scoring and jobs |
| Web | Next.js 15, App Router, React 19 | SSR for the marketing pages, route handlers for the API |
| Styling | Tailwind + tokens generated from Figma variables | The colour tokens already exist; export them rather than retyping hex |
| Validation | Zod at every boundary | Request bodies, grader responses, template payloads |
| Database | PostgreSQL 16 | Relational data, strong constraints, `jsonb` where the shape genuinely varies |
| ORM | Drizzle | Typed, thin, and does not fight raw SQL for the queue queries |
| Auth | Auth.js v5, Postgres adapter, email + Google | No per-MAU cost on a free product. Clerk is a drop-in swap if the team would rather buy it |
| Grader | Python 3.12, FastAPI, SymPy | Algebraic equivalence has no credible JS equivalent |
| Email | Amazon SES | Same cloud, cheapest at this volume |
| Tests | Vitest, fast-check, Playwright | Unit, property, end-to-end |
| IaC | AWS CDK (TypeScript) | Same language as the app; both options expressed as one stack with a size parameter |

### Package layout

A single repository, pnpm workspaces:

```
apps/web            Next.js — UI and API route handlers
apps/grader         Python FastAPI service
apps/jobs           scheduled job handlers
packages/scoring    pure scoring core (§6)
packages/items      sampling, rendering, numeric answer checking (§7)
packages/db         Drizzle schema, migrations, query helpers
packages/tokens     design tokens exported from Figma
infra/              CDK app, one stack, size parameter selects A or B
```

`packages/scoring` has **no dependencies** — not on the database, not on the ORM, not on Next.js. That is enforced by a lint rule, because it is the constraint most likely to erode under deadline.

## 4. Component architecture

The logical system, identical in both options. Only the boxes' hosting changes.

```
   browser
      │  HTTPS
      ▼
┌──────────────────────────────────────┐
│ Web application (Next.js)            │
│  ├── marketing pages    (public)     │
│  ├── app UI             (auth'd)     │
│  ├── API route handlers              │
│  │     ├── session runner            │
│  │     ├── home / skills / settings  │
│  │     └── admin                     │
│  ├── packages/scoring   (pure)       │
│  └── packages/items     (pure)       │
└───┬──────────────┬───────────────┬───┘
    │              │               │
    ▼              ▼               ▼
┌────────┐   ┌──────────┐   ┌───────────┐
│Postgres│   │ Grader   │   │ Email SES │
│        │   │ (Python) │   └───────────┘
└────────┘   └──────────┘
    ▲
    │
┌───┴──────────────────────────────────┐
│ Scheduled jobs                        │
│  · abandonment sweeper   (every 5m)   │
│  · review-due email      (hourly)     │
│  · item stats rollup     (nightly)    │
│  · weekly summary        (weekly)     │
│  · θ replay after void   (on demand)  │
└───────────────────────────────────────┘
```

### Why the grader is a separate process and not a library

It is Python and the app is TypeScript, so there is no choice about the boundary — only about whether it is a network call or a subprocess. A network call wins: it can be scaled, timed out and failed over independently, and a SymPy expression that hangs takes down one request rather than a web worker.

### Why jobs are separate from the web process

A cron loop inside the web container breaks the moment there are two containers — every job runs twice. Both options run jobs as separate invocations triggered by EventBridge Scheduler, which also means a job failure is visible as a failed invocation rather than a silent no-op.

### Request path for the hot operation

Submitting an answer is the only latency-sensitive path:

1. Claim the served item atomically (`status: served → grading`).
2. Grade — in-process for numeric and MCQ, over HTTP for symbolic.
3. In one transaction: append the response row, update `user_skill_state`, recompute level, recompute `due_at`, update prerequisite θ.
4. Return the verdict, solution and deltas.

**The grader call sits between two transactions, never inside one.** Holding a database transaction open across a network call is how a slow grader turns into connection-pool exhaustion and a site-wide outage.

## 5. Data model

Postgres. Identifiers are UUIDv7 so they sort by creation time. All timestamps `timestamptz`, all money-free, all rates stored as `double precision`.

### Content tables — authored, versioned, low write volume

| Table | Key columns |
| --- | --- |
| `domains` | id, slug, name |
| `skills` | id, slug, domain\_id, name, importance 1-3, required\_band |
| `skill_prereqs` | skill\_id, prereq\_id — PK both, direct edges only |
| `misconceptions` | id, skill\_id, name, explanation |
| `lessons` | id, skill\_id, version, body\_md, published\_at |
| `item_templates` | id, **version**, skill\_id, band, type, status, time\_limit\_sec, payload `jsonb`, change\_class, author\_id, reviewer\_id — PK (id, version) |
| `archetypes` | id, name, weights `jsonb`, required\_skills `jsonb` |

`payload` is `jsonb` because the five item types have genuinely different shapes (product spec §8.2) and a normalised schema would be six joins to render one question. It is validated by a Zod schema per type on write, so the looseness is at rest, not at the boundary.

### User state — small, hot, read on every page

| Table | Key columns |
| --- | --- |
| `users` | id, email, timezone, archetype\_id, interview\_date, prefs `jsonb`, deleted\_at |
| `user_skill_state` | **PK (user\_id, skill\_id)**, theta, level, cold\_streak, stability\_s, last\_correct\_at, **due\_at**, attempts, inferred, updated\_at |

`user_skill_state` is \~40 rows per user. Readiness (product spec §6) is **computed on read** from those rows — a 40-row scan and some arithmetic, well under a millisecond. Materialising it would create a cache to invalidate on every answer, for no gain.

### Session and response tables — the write path

| Table | Key columns |
| --- | --- |
| `sessions` | id, user\_id, mode (practice/assessment/placement), started\_at, ended\_at, target\_items, config `jsonb` |
| `session_items` | id, session\_id, user\_id, template\_id, template\_version, seed, band, **status**, served\_at, submitted\_at, elapsed\_ms, verdict `jsonb` |
| `responses` | id, session\_item\_id, user\_id, skill\_id, template\_id, template\_version, seed, submitted\_raw, y, correct, timed\_out, elapsed\_ms, p\_pred, theta\_before, theta\_after, b\_before, b\_after, misconception\_id, mode, created\_at, **voided\_at** |
| `flags` | id, user\_id, session\_item\_id, template\_id, version, seed, note, status, resolved\_by |
| `outcomes` | id, user\_id, firm, stage, result, readiness\_at\_time, created\_at |
| `item_stats` | PK (template\_id, version), responses, correct, mean\_elapsed\_ms, discrimination, flag\_count, b |

`session_items.status` ∈ `served | grading | answered | timed_out | ungraded | abandoned`. The `grading` state exists so that a process dying mid-grade is recoverable by the sweeper rather than leaving an item that can never be answered.

`responses` is **append-only**. Voiding sets `voided_at`; nothing is deleted and no row is mutated otherwise. `verdict` on `session_items` caches the rendered result so that a resubmit or a refresh replays the same answer screen without regrading.

### Stored vs derived

| Value | Decision | Reason |
| --- | --- | --- |
| Readiness score | derived on read | 40 rows, trivial arithmetic, no invalidation problem |
| Retention `r` | derived on read | pure function of `now`, `last_correct_at`, `S` |
| **`due_at`** | **stored and indexed** | the review queue needs `WHERE due_at < now()`; a time-dependent expression cannot be indexed |
| Level | stored | it is a state machine with history-dependent transitions, not a formula |
| Item difficulty `b` | stored on `item_stats` | shared across users, updated on every response |
| Discrimination | derived nightly | needs a correlation across all responses; not a read-path concern |

### Indexes that matter

```sql
-- the review queue, per user
create index on user_skill_state (user_id, due_at)
  where due_at is not null;

-- session history and the θ replay job
create index on responses (user_id, skill_id, created_at)
  where voided_at is null;

-- seen-instance check (product spec §8.3)
-- keyed on instance_hash, NOT seed: a template with few or no parameters
-- yields the same question from different seeds
create index on responses (user_id, template_id, instance_hash);

-- the sweeper
create index on session_items (status, served_at)
  where status in ('served','grading');

-- item health rollup
create index on responses (template_id, template_version, created_at);
```

`instance_hash` is a SHA-256 over the template id, version and the **sampled parameter values** — not the seed — stored on both `session_items` and `responses`. Two seeds that sample identical parameters are the same question and must be treated as seen. This was found while building the content exemplars: a symbolic template with no parameters produces one instance from every seed, and a seed-keyed check would serve it to the same user repeatedly while believing it unseen.

### Deletion

Account deletion hard-deletes the `users` row and everything personally identifying. `responses` rows are **retained with `user_id` set to null** — de-identified, keeping the item calibration data that every other user's difficulty estimates depend on. This is a legitimate-interest retention that the privacy policy must state plainly, and it is the one place where the product's needs and a deletion request genuinely pull against each other.

## 6. The scoring core

`packages/scoring` implements every formula in product spec §3–§7. It is the most important module in the codebase and the one most likely to be quietly compromised, so its constraints are worth stating as code rules rather than intentions.

### Surface

```ts
type SkillState = {
  theta: number; level: 0|1|2|3; coldStreak: number;
  stabilityS: number; lastCorrectAt: Date | null;
  attempts: number; inferred: boolean;
};

type Outcome = {
  y: number;              // 1, 0, or fractional for multi-step / drill
  band: 1|2|3|4|5;
  b: number;              // item difficulty at time of answer
  timedOut: boolean;
  withinLimit: boolean;
  seenSeedBefore: boolean;
  itemResponseCount: number;   // drives the confidence multiplier
  setSize?: number;            // drills only
};

predictP(theta, b): number
applyResponse(state, outcome, now): { state: SkillState; delta: Delta }
propagateToPrereq(prereqState, outcome, now): SkillState
evaluateLevel(state, recent: Outcome[]): 0|1|2|3
nextDueAt(state, now, interviewDate?): Date
readiness(states, skills, archetype): {
  score: number | null;        // null = provisional
  domains: DomainScore[];
  weakestDomain: string;
  provisionalReason?: string;
}
replay(responses: StoredResponse[]): SkillState
```

### Rules

- **No imports** outside the standard library. Enforced by an ESLint boundary rule and a dependency-cruiser check in CI.
- **`now` is always a parameter.** Nothing calls `Date.now()`. This is what makes retention and scheduling testable without freezing system time.
- **Pure and total.** No exceptions for domain conditions; invalid input is a type error or a clamped value, never a throw in the request path.
- **Every constant is a named export** in `constants.ts`, mirroring product spec §20 exactly. Changing a tunable is a one-line diff with a test that asserts the published value.

### Why `replay` exists

When an item is voided (product spec §12.4, §16.2), affected users' θ must be rebuilt without those responses. `replay` folds `applyResponse` over the surviving response rows in order. Because the module is pure and `now` is injected, replaying yesterday's history produces exactly the number the user would have had — not an approximation.

This is only true if nothing else writes θ. Any code path that adjusts a skill state outside this module is a bug, and the `user_skill_state` table should carry a database trigger asserting that `theta_after` on the latest response matches, as a cheap tripwire in staging.

## 7. Item instancing

`packages/items` turns `(template, seed)` into a rendered question, and checks numeric answers. Also pure, also no I/O.

### The PRNG

`xoshiro128**`, seeded with FNV-1a over `"{template_id}:{version}:{seed}"`. Hand-rolled in about thirty lines — not `Math.random`, which has no seeding, and not a dependency, because this algorithm must not change between library versions. A change to the PRNG changes every instance every user has ever seen and silently invalidates the seen-seed guarantee.

**The PRNG implementation is covered by a golden test**: a fixed seed produces a fixed sequence, asserted against a committed fixture. If that test fails, the change is wrong by definition.

### Sampling

1. Sample parameters in declared order.
2. Evaluate constraints. On failure, resample — up to 50 attempts (product spec §8.3).
3. On exhaustion, throw `OverConstrainedTemplate`, log the template id, and serve a different item. In the admin tool the same condition fails the seed sweep and blocks promotion.

### Expression evaluation

Constraints and numeric answers are expressions over parameters. They are evaluated by a **small hand-written parser** — shunting-yard to RPN, then evaluate — supporting `+ - * / ^ ( )`, comparison and boolean operators, the constants `pi` and `e`, and a fixed whitelist of functions: `floor`, `ceil`, `abs`, `min`, `max`, `sqrt`, `log`, `exp`, `factorial`, `choose`, `mod`. There is deliberately **no `sum`**: it forces authors to derive the closed form, which is usually what the question is testing. The content pack's `tools/validate.py` implements the same grammar in Python and must be kept in step.

**Not `eval`, not `new Function`, not a general-purpose maths library.** These expressions come from authored content that will eventually be edited by contractors, and the parser is the trust boundary. It is perhaps 200 lines and it removes an entire class of incident.

### Numeric answer checking

The user's submission goes through the same parser with a reduced grammar — no variables, no comparison operators, depth cap 32, length cap 256. Then the comparison from product spec §8.4. Parse failure is a validation error shown inline ("not a number"), **not** a wrong answer: a typo that the parser rejects should not cost a user their cold streak.

### Rendering

Stems are templates with `{{param}}` substitution and a small number of formatting directives (`{{n|fraction}}`, `{{p|percent}}`). Rendering happens **server-side** so that the client never receives the parameter set in a form that reveals the answer expression.

## 8. API surface

REST over JSON, Next.js route handlers, Zod-validated. Not tRPC — the admin tool and any future mobile client benefit from an explicit contract, and the surface is small enough that the type-sharing tRPC buys is not worth the coupling.

### Session runner

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/sessions` | `{ mode }`. Composes the session per product spec §10.1. Returns session id and the first item |
| `GET` | `/api/sessions/:id/next` | Serves the next item, records `served_at`. **Mutating despite being a GET?** No — it is `POST /next`. See below |
| `POST` | `/api/sessions/:id/next` | Returns `{ sessionItemId, type, stem, options?, timeLimitSec, servedAt, remaining }` |
| `POST` | `/api/session-items/:id/answer` | `{ raw, clientElapsedMs }` → verdict |
| `POST` | `/api/session-items/:id/step` | Multi-step checkpoints; same claim semantics, per-checkpoint |
| `POST` | `/api/sessions/:id/end` | Finalises, resolves outstanding items, returns the summary payload |
| `POST` | `/api/session-items/:id/flag` | `{ note? }` |

Serving an item mutates state, so it is a `POST`. This matters more than the aesthetics: a `GET` would be prefetched by the browser, retried by proxies, and would start the clock on an item the user has not seen.

### Claim semantics

The submit handler's first statement:

```sql
update session_items
   set status = 'grading', submitted_at = now()
 where id = $1 and user_id = $2 and status = 'served'
returning *;
```

- **One row** → we own this submission; proceed.
- **Zero rows, status already `answered`** → return the cached `verdict`. A refresh or double-click replays the same answer screen rather than erroring.
- **Zero rows, status `grading`** → `409`, client retries after a moment.
- **Zero rows, not found** → `404`.

This single statement is what makes "one submission per item" (product spec §9.3) true under concurrency, without a distributed lock.

### Elapsed time

`elapsed_ms = now() − served_at`, computed in Postgres. `clientElapsedMs` is stored for discrepancy detection only. If `|client − server| > 3000ms`, the response is tagged for review — clock skew is usually innocent, but a consistent pattern per user is not.

### Read endpoints

| Method | Path | Returns |
| --- | --- | --- |
| `GET` | `/api/home` | readiness, domain scores, weakest link, skill list, three rail cards |
| `GET` | `/api/skills` | full catalogue with the viewer's state |
| `GET` | `/api/skills/:slug` | lesson, worked example, state, Level 3 criteria |
| `GET` | `/api/me` | settings payload |
| `PATCH` | `/api/me` | settings mutation |
| `POST` | `/api/me/export` | enqueues a CSV export, emails a signed link |
| `DELETE` | `/api/me` | deletion per §5 |

`GET /api/home` is the most-called endpoint. It is a handful of indexed queries plus §6's `readiness()`; budget 150ms p95 and do not cache it — a stale readiness score after a session is worse than a fast one.

### Admin

All under `/api/admin/*`, gated on `role = 'author' | 'reviewer' | 'admin'`, separate from user auth checks so that a bug in one cannot open the other.

| Method | Path | Notes |
| --- | --- | --- |
| `GET/POST/PATCH` | `/api/admin/templates` | version-aware; PATCH creates a version, never mutates (product spec §16.1) |
| `POST` | `/api/admin/templates/:id/sweep` | the 200-seed sweep (product spec §12.2) — required before promotion |
| `POST` | `/api/admin/templates/:id/promote` | `{ changeClass }`; Corrective requires a typed confirmation string |
| `GET` | `/api/admin/review` | the review queue |
| `GET/POST` | `/api/admin/flags` | flag queue, resolve, retire |
| `GET` | `/api/admin/stats` | item health (product spec §12.5) |

### Errors

One shape everywhere: `{ error: { code, message, field? } }` with stable machine codes (`ITEM_ALREADY_ANSWERED`, `GRADER_UNAVAILABLE`, `PREREQ_NOT_MET`, `RATE_LIMITED`). The UI maps codes to the copy already written in the Figma edge-states frame; it never displays a raw message.

## 9. The grader service

A small Python service with one job: decide whether two mathematical expressions are equivalent. It holds no user data, no database connection and no state.

### Contract

```http
POST /grade
{
  "kind": "symbolic",
  "submitted": "k*(N - k)",
  "answer": "k*N - k**2",
  "variables": ["k", "N"],
  "assumptions": { "k": "positive integer", "N": "positive integer" },
  "probePoints": 20
}

200 OK
{
  "correct": true,
  "method": "algebraic",        // or "numeric_probe"
  "normalised": "k*(N - k)",
  "graderVersion": "1.0.0"
}
```

Failure modes are explicit and distinguishable:

| Response | Meaning | App behaviour |
| --- | --- | --- |
| `200 correct: false` | graded, wrong | Normal incorrect path |
| `422 PARSE_ERROR` | the submission is not a valid expression | Inline validation error — **not** a wrong answer |
| `504` / timeout / connection refused | grader unavailable | **Void the item** (product spec §8.1.3) |
| `500` | grader bug | Void the item, alarm |

### Implementation notes

- `sympy.parse_expr` with `standard_transformations` only, a restricted namespace, and `evaluate=False`. No `sympify` on raw strings.
- Reject before parsing: length > 512, depth > 32, any `__`, any character outside the expected set.
- `simplify(submitted - answer) == 0` under the declared assumptions, with a hard time budget of **1.5s** enforced inside the process.
- On budget exhaustion, fall back to the numeric probe: evaluate both at 20 pseudo-random points in the declared domain, accept if all agree within 1e-9 relative. The probe is fast, and for the expression shapes this product asks for it is right in practice.
- Return `method` so that a reviewer investigating a disputed answer can see which path decided it.

### Timeouts, stacked

| Layer | Budget |
| --- | --- |
| SymPy `simplify` | 1.5s, then probe |
| Grader request handler | 1.8s hard |
| App-side HTTP client | 2.0s |
| User-visible submit | \~2.5s worst case, then the void path |

Each layer is strictly shorter than the one above it. Getting this ordering wrong is how a 2-second grader becomes a 30-second page.

### Warmth

SymPy's import alone is roughly a second. Whether that matters is the main difference between the two deployment options: Option A uses Lambda **with SnapStart** to restore from a snapshot taken after import; Option B keeps warm containers and never pays it. Both meet the budget; only one of them is free when idle.

## 10. Security and integrity

### What never leaves the server

The item payload sent to a client contains the rendered stem, the type, MCQ option text, and the time limit. It does **not** contain the answer, the answer expression, the parameter set, solution steps, misconception text, or which option is correct. These live behind a projection function in `packages/items`; there is exactly one function that builds a client payload, and it is the only place a mistake could happen.

### Rate limits

| Action | Limit |
| --- | --- |
| Answer submission | 60 / minute / user |
| Session creation | 10 / hour / user |
| Flags | 5 / hour / user |
| Auth attempts | 10 / hour / IP |
| Export request | 3 / day / user |
| Admin mutations | 300 / hour / user |

Counters live in Postgres in Option A (a small table with a periodic sweep — adequate at this volume) and in Valkey in Option B. The interface is the same; only the store differs.

### Authorisation

**Passwordless.** Auth.js email provider (magic link, 15-minute single-use tokens, stored hashed) plus Google OAuth. No credentials provider, no password storage, no reset flow — product spec §18.3. Sessions are database-backed so they can be revoked, which account deletion and a compromised-email report both require.

Every handler resolves the session user server-side and scopes queries by `user_id`. No handler accepts a user id from the client. Admin routes check role separately and are mounted on a distinct path prefix so that a middleware misconfiguration cannot silently expose them. Sign-up asserts a minimum age of 16 (product spec §18.5) and records the assertion with a timestamp.

### Headers and CSP

Strict CSP with nonces, no `unsafe-inline`, no `unsafe-eval` — the expression parser (§7) exists partly so this is possible. HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying everything not used.

### Data protection

- Postgres encrypted at rest; TLS enforced in transit, `sslmode=verify-full`.
- Secrets from SSM Parameter Store (A) or Secrets Manager (B); never in environment files in the repository.
- Email addresses are the only meaningful PII. No payment data exists at launch, which keeps the product out of PCI scope entirely — a point worth protecting when payments are eventually added.
- Export produces a CSV of the user's own responses, delivered by a **pre-signed S3 URL expiring in one hour**, not as an email attachment.

### Integrity

The measures in product spec §9 are implemented as: server-computed elapsed time, the single-claim update in §8, resolution of abandoned items by the sweeper, and one submission per item enforced by the database rather than the UI. None of this stops a determined user with a second device, and it is not meant to. It stops the accidental invalidation of the dataset.

## 11. Analytics and observability

### Event list

Product spec §14 sets targets but never names the events. These are they — emitted server-side, because client-side events are lost to ad blockers at exactly the rate that correlates with this audience.

| Event | Properties |
| --- | --- |
| `signup_started` | source, referrer |
| `signup_completed` | method |
| `archetype_selected` | archetype |
| `placement_started` | — |
| `placement_item_answered` | index, band, correct |
| `placement_completed` | items, abandoned |
| `placement_skipped` | at\_item |
| `session_started` | mode, target\_items, composition |
| `item_served` | template, version, band, type, skill, bucket, predicted\_p |
| `item_answered` | correct, elapsed\_ms, timed\_out, band, type, predicted\_p |
| `item_flagged` | template, version, reason |
| `item_voided` | template, cause |
| `session_completed` | items, correct, duration, levels\_gained |
| `session_abandoned` | at\_item, duration |
| `level_changed` | skill, from, to, cause |
| `readiness_computed` | score, weakest\_domain, provisional |
| `assessment_unlocked` | days\_since\_signup, skills\_at\_working |
| `assessment_completed` | score, passed, recalibrated\_skills |
| `review_email_sent` / `_clicked` | due\_count |
| `outcome_reported` | firm, stage, result, readiness\_at\_time |

`item_served` carrying `predicted_p` alongside `item_answered`'s outcome is what makes the **Brier score** computable without a join back to the response table — and product spec §14.3 treats that number as the honest test of whether the whole mastery model works.

### Where events go

**Option A:** an `events` table in Postgres, queried directly. At 100 users this is thousands of rows a day and a `GROUP BY` answers every funnel question.

**Option B:** Kinesis Firehose → S3 as Parquet → Athena, with the `events` table dropped. The switch is one implementation of an `EventSink` interface.

### Operational metrics

RED on every route — rate, errors, duration — plus:

| Metric | Why |
| --- | --- |
| Grader p99 and failure rate | drives the void path; a rising failure rate is a silent product degradation |
| `session_items` stuck in `grading` | should be near zero; non-zero means the sweeper or the grader is unwell |
| Void rate per template | a spike identifies a bad item faster than user flags do |
| Submit p95 by item type | symbolic is the one that will drift |
| DB connection pool saturation | the first thing to break under load |
| Predicted-vs-actual calibration drift | model health, reviewed monthly |

### Alarms worth waking someone for

1. 5xx rate > 2% over 5 minutes
2. Grader failure rate > 10% over 5 minutes
3. Database CPU > 85% for 10 minutes, or storage > 85%
4. Items stuck in `grading` > 50
5. Zero sessions started in 6 hours during waking hours — the "is it actually up?" check that synthetic pings miss

Option A routes these to email and Slack. Option B adds PagerDuty and a synthetic canary running the full session loop every 5 minutes.

## 12. Testing

### Property tests on the scoring core

The scoring module is pure, which makes it unusually amenable to property testing. `fast-check`, run in CI:

- θ moves **up** on a correct answer and **down** on an incorrect one, for every reachable state and any item difficulty.
- |Δθ| ≤ `Kᵤ` always. No input produces an unbounded jump.
- Retention `r` is monotonically decreasing in elapsed time and always in \[0, 1\].
- Stability never falls below 2 days or exceeds 180.
- Level never advances to 3 without three consecutive unseen-seed successes at band ≥ 3 inside the limit — asserted by generating random response histories and checking the invariant rather than the implementation.
- Readiness is bounded by its weakest domain score from above, and by the arithmetic mean from below.
- **`replay(responses)` equals the state produced by applying those responses one at a time.** The single most important test in the suite; it is what makes voiding an item safe.

### Golden tests on item generation

Committed fixtures assert that a given `(template, version, seed)` produces an exact parameter set, stem and answer. A diff here means either an intentional content version bump or a bug in the PRNG — and the fixtures make the distinction impossible to miss.

The 200-seed sweep (product spec §12.2) also runs in CI over **every live template**, so a library upgrade that changes floating-point behaviour fails the build rather than reaching a user.

### Hostile-client suite

Playwright tests that do what a curious quant candidate will do on day one:

1. Submit the same item twice → second returns the cached verdict, θ moves once.
2. Submit after the time limit → scored as a timeout.
3. Replay a captured submit request → rejected.
4. Inspect the served-item network payload → assert the answer is absent. **This assertion runs on every build.**
5. Open two tabs on the same session and answer in both → exactly one wins.
6. Kill the grader, submit a symbolic item → voided, θ unchanged, item requeued.

### Contract tests

The grader has a shared fixture file of expression pairs with expected verdicts, run against the real service in CI. It catches SymPy upgrades changing behaviour, which they do.

### Load

Option A: 20 concurrent sessions sustained for 10 minutes. Option B: 500 concurrent, plus a spike test at 5× to confirm autoscaling reacts before the connection pool saturates.

## 13. Non-functional requirements

### Latency budgets

Measured server-side, at the route handler, excluding network.

| Operation | p50 | p95 | Hard ceiling |
| --- | --- | --- | --- |
| `POST /sessions/:id/next` | 60ms | **200ms** | 1s |
| Submit — numeric / MCQ | 80ms | **250ms** | 1s |
| Submit — symbolic | 300ms | **900ms** | 2.5s then void |
| `GET /api/home` | 50ms | **150ms** | 1s |
| Catalogue | 60ms | 200ms | 1s |
| Marketing page TTFB | 100ms | 300ms | — |

The serve-item budget is the one that matters most: it sits between the user pressing *next* and the clock starting, and any latency there is time stolen from their answer. **The clock starts at `served_at`, which is recorded when the handler completes**, not when the request arrives — so a slow response costs the product, not the user.

### Frontend

LCP < 2.0s on the landing page over a 4G profile; the app shell under 200KB gzipped JavaScript. The session runner must be usable from the keyboard alone, and must not shift layout when a verdict renders — a layout shift at the moment an answer resolves is how a user mis-clicks *next*.

### Browser support

Last two major versions of Chrome, Edge, Firefox and Safari. Below 1024px the app shows the desktop-required interstitial (product spec §17.1). No IE, no legacy Edge.

### Capacity

|  | Option A | Option B |
| --- | --- | --- |
| Registered users | 500 | 50,000 |
| Concurrent sessions | 20 | 2,000 |
| Answers / second, peak | 5 | 300 |
| Database size, year 1 | < 5 GB | < 200 GB |

The volumes are genuinely small. A single answer is one row of a few hundred bytes; 100 committed users generating 24 answers a day is 2,400 rows a day. This is why Option A is viable and why anyone reaching for Kubernetes at this stage is solving a problem they do not have.

### Availability and durability

|  | Option A | Option B |
| --- | --- | --- |
| Availability target | 99.5% (\~3.6h/month) | 99.9% (\~43m/month) |
| RPO | 24h snapshot + 5-minute PITR | 5-minute PITR |
| RTO | \~2 hours, manual | \~15 minutes, mostly automatic |
| Planned maintenance | announced, in a window | rolling, invisible |

99.5% is an honest target for a free product with one engineer. It should be stated on the status page rather than implied to be better.

### Data retention

Responses indefinitely, de-identified on account deletion (§5). Application logs 14 days in A, 30 in B. Analytics events 90 days in Postgres (A) or indefinitely in S3 (B). Database backups 7 days in A, 35 in B.

## 14. Option A — Lean AWS

For launch and roughly the first 100–500 users. Single AZ, managed services only, no Kubernetes, no message broker, nothing that needs a person watching it.

Region: **eu-west-2 (London)** — the product's timezone defaults and its first market are UK.

### Architecture

```
Route 53 ─→ CloudFront ─→ App Runner service (Next.js container)
                               │ VPC connector
                               ▼
                        ┌──────────────┐
              private   │ RDS Postgres │  db.t4g.micro, single-AZ
              subnets   │              │  20GB gp3, 7-day PITR
                        └──────────────┘
                               │
              ┌────────────────┼──────────────────┐
              ▼                ▼                  ▼
      Lambda (grader)   Lambda (jobs)      NAT instance (t4g.nano)
      Python + SymPy    5 schedules        → SES, outbound
      SnapStart on      EventBridge
```

### Services

| Service | Configuration | Role |
| --- | --- | --- |
| **App Runner** | 1 vCPU / 2 GB, 1–2 instances, VPC connector | Runs the Next.js container. Deploys from an ECR image push; no cluster to manage |
| **RDS Postgres 16** | db.t4g.micro, single-AZ, 20 GB gp3, 7-day retention | The database. Graviton, burstable, and genuinely adequate at this volume |
| **Lambda (grader)** | Python 3.12, 1 GB, **SnapStart**, SymPy in a layer | Invoked directly by the AWS SDK — no API Gateway, one less hop and one less bill |
| **Lambda (jobs)** | 512 MB, one function, five EventBridge schedules | Sweeper, review email, weekly summary, stats rollup, θ replay |
| **EventBridge Scheduler** | 5 rules | Cron, outside the web container |
| **SES** | verified domain, DKIM | Email |
| **S3 + CloudFront** | one bucket, OAC | Static assets and user exports |
| **SSM Parameter Store** | standard tier | Secrets — free, unlike Secrets Manager |
| **CloudWatch** | 14-day retention, 5 alarms | Logs, metrics, alarms to email and Slack |

### Cost, monthly

| Line | \~USD |
| --- | --- |
| App Runner, 1 vCPU / 2 GB | 15 |
| RDS db.t4g.micro + 20 GB | 16 |
| NAT instance (t4g.nano + EBS) | 4 |
| Lambda grader + jobs | 1 |
| CloudFront + S3 | 2 |
| SES | < 1 |
| CloudWatch logs and alarms | 3 |
| Route 53 | 1 |
| **Total** | **≈ $42** |

Plus roughly $20 of ECR storage and data transfer in a busy month. **Budget $50–65.**

### Three traps worth naming

**1. The NAT Gateway trap — $32/month for nothing.** Attaching a VPC connector to App Runner routes *all* outbound traffic through the VPC, including calls to SES and Lambda. The obvious fix is a NAT Gateway, which costs more than the database. Use a **NAT instance** (a t4g.nano running the fck-nat AMI, about $4) or VPC interface endpoints for SES, Lambda and SSM (about $7 each — cheaper only if you need fewer than two). This single decision is the difference between a $45 and a $75 bill, and it catches almost everyone.

**2. SES starts in sandbox.** You can only email verified addresses until AWS grants production access, which takes a day or two and a written explanation. Request it in week one, not the day before launch.

**3. App Runner has no scale-to-zero.** It bills for provisioned memory continuously. There is no configuration in which this service costs nothing overnight; if that matters, the alternative is Lambda-hosted Next.js via OpenNext, at the cost of cold starts on the marketing pages.

### What you are giving up

- **Single AZ.** An availability-zone failure is an outage until you restore, which is a manual `restore-to-point-in-time` and a DNS change. Practise it once; do not discover it live.
- **No read replica**, so a heavy analytics query competes with live traffic. At this volume it will not bite, but the discipline of not running exploratory SQL against production is worth keeping from day one.
- **Burstable CPU.** t4g instances accrue credits; a sustained load spike can exhaust them and degrade sharply rather than gracefully. The CPU-credit-balance alarm is not optional.
- **Deploys have a gap.** App Runner rolls instances, but with one instance there is a brief window of 502s. Acceptable at launch; announce maintenance windows.

### When to leave

Move to Option B when any of these is true: sustained database CPU above 60%, more than 50 concurrent sessions, revenue depending on uptime, a second engineer joining, or the first time an outage costs more to explain than the upgrade costs to deploy.

## 15. Option B — Robust AWS

Same application, same region, multi-AZ throughout. Sized for thousands of concurrent users and for a business where an outage costs something.

### Architecture

```
Route 53
   |
CloudFront  --  WAF (rate rules on /api/session-items/*)
   |
ALB (2 AZs, TLS termination)
   |
ECS Fargate - web service
   2-10 tasks, 1 vCPU / 2 GB, autoscale on RPS + CPU
   |
   +--> RDS Proxy --> RDS Postgres Multi-AZ (db.t4g.medium)
   |                  + read replica for analytics
   +--> ECS Fargate - grader service (2-6 tasks, always warm)
   |       Cloud Map service discovery, internal only
   +--> ElastiCache Valkey (2 nodes, Multi-AZ)
   +--> SQS --> ECS Fargate - worker service
                 (email, exports, theta replay, stats rollup)

EventBridge Scheduler --> SQS --> worker
Kinesis Firehose --> S3 (Parquet) --> Athena
```

### What each addition actually buys

| Addition | Buys |
| --- | --- |
| **ALB + 2 AZs** | Survives an AZ failure. Zero-downtime rolling deploys, so no maintenance windows |
| **ECS Fargate over App Runner** | Real autoscaling policies, task-level control, blue/green via CodeDeploy, a path to spot capacity for the worker |
| **RDS Multi-AZ** | Automatic failover in 60–120s instead of a manual restore. The single biggest availability gain on the list |
| **RDS Proxy** | Connection pooling that survives task churn. Without it, autoscaling web tasks exhaust Postgres connections precisely when traffic is highest |
| **Read replica** | Analytics, exports and the nightly stats rollup stop competing with the answer path |
| **Grader on Fargate, always warm** | Removes cold-start variance entirely. Symbolic submit p95 drops from \~900ms to \~300ms |
| **ElastiCache Valkey** | Rate limiting, idempotency keys and the home read cache, without hammering Postgres |
| **SQS + worker** | Email, exports and θ replay stop running inside a request. Retries and DLQs become visible rather than lost |
| **WAF** | Rate-based rules on the submit endpoint, bot control on signup. Cheap insurance for a product whose users enjoy puzzles |
| **Firehose → S3 → Athena** | Analytics that scale past what a `GROUP BY` on production can serve |
| **CodeDeploy blue/green** | Rollback in seconds on an alarm, rather than by redeploying |

### Cost, monthly

| Line | \~USD |
| --- | --- |
| ECS Fargate — web, 2 tasks baseline | 72 |
| ECS Fargate — grader, 2 tasks | 36 |
| ECS Fargate — worker, 1 task | 18 |
| ALB | 23 |
| CloudFront | 10 |
| WAF | 12 |
| RDS db.t4g.medium Multi-AZ + 100 GB | 123 |
| RDS read replica | 54 |
| RDS Proxy | 22 |
| ElastiCache Valkey, 2 × t4g.micro | 25 |
| NAT Gateways, 2 AZs + data | 75 |
| SQS, EventBridge, Firehose | 12 |
| S3 + Athena | 10 |
| CloudWatch, X-Ray, synthetics | 35 |
| Secrets Manager | 2 |
| **Total** | **≈ $529** |

With headroom for traffic, logs and a larger database instance: **budget $650–800**.

### Where the money actually goes

Database and NAT are 40% of the bill before a single user arrives. Two things follow. **NAT Gateways at $75/month are the quietly expensive item** — VPC endpoints for S3, SQS, SES and ECR remove most of that traffic and pay for themselves above two AZs. And the read replica is the easiest line to defer: add it when analytics queries start appearing in slow-query logs, not before.

### Scaling policy

Web tasks scale on ALB requests-per-target, target 40 RPS, min 2, max 10, 60-second cooldown. The grader scales on CPU with a min of **2 — never 1**, because a single warm task means the first request after a deploy pays the SymPy import.

**The database does not autoscale.** Vertical resizing is a maintenance event. Watch connection count and CPU, and size up deliberately in a quiet window.

## 16. Choosing, and the path between them

### The recommendation

**Start on Option A.** The product launches free, to an unknown audience, with a content library that took longer to build than the software. Spending $650 a month to serve 100 users buys availability that nobody has yet asked for, and the $600 difference is a week of a contract author — which is the actual constraint on this launch.

The argument for starting on B is not cost, it is avoided migration work. That argument is weak here because the migration is genuinely small, and §16.3 is a list of decisions rather than a project.

### Side by side

|  | Option A | Option B |
| --- | --- | --- |
| Monthly cost | \~$50 | \~$700 |
| Setup effort | 2–3 days | 1.5–2 weeks |
| Availability | 99.5%, single AZ | 99.9%, multi-AZ |
| Deploys | brief 502 window | zero downtime, instant rollback |
| DB failure | manual restore, \~2h | automatic, \~90s |
| Symbolic submit p95 | \~900ms | \~300ms |
| Concurrent sessions | 20 | 2,000 |
| Ops load | a few hours a month | part of someone's week |
| Analytics | SQL on production | Athena over S3 |

### What must be right on day one

These are the things that make A → B a deployment change. All of them are free if decided now and expensive if discovered later.

1. **No local state.** No files on disk, no in-memory cache that matters, no sticky sessions. Uploads and exports go to S3 from the first commit even when there is one container.
2. **One database module.** Every query goes through `packages/db`. Introducing RDS Proxy later becomes a connection-string change rather than an audit.
3. **The grader behind an interface.** `GraderClient` with two implementations — `LambdaInvokeGrader` and `HttpGrader` — selected by environment variable. Written on day one, the switch is one line.
4. **`EventSink` and `RateLimiter` as interfaces.** Postgres implementations now; Firehose and Valkey later. Both are under 50 lines each.
5. **Jobs are handlers, not cron.** A job is a function taking a payload. In A it is invoked by EventBridge; in B the same function is invoked from an SQS consumer.
6. **One CDK stack with a `size` parameter.** Not two stacks. `size: 'lean' | 'robust'` selects the constructs, so the two options cannot drift in VPC layout, security groups or IAM.
7. **Config from the environment, always.** No `if (process.env.NODE_ENV === 'production')` branching in application logic.

### The migration itself

Assuming the above, roughly two days of work and one short maintenance window:

1. Deploy the B stack alongside A, pointing at a **replica** of the A database.
2. Run the load test against B.
3. Maintenance window: stop writes on A, promote the replica, cut DNS to CloudFront.
4. Keep A running for 48 hours as a rollback path, then destroy it.

The only genuinely irreversible step is the database promotion, which is why it happens in a window rather than live.

### The middle path

If A feels too thin but B is premature, the highest-value single upgrade is **RDS Multi-AZ (+$60/month)**. It removes the worst failure mode — a manual database restore performed by a stressed person — for a tenth of the cost of the full option. Take that first; take everything else when the numbers in §14's *when to leave* say so.

## 17. Environments and delivery

### Environments

|  | Purpose | Backing |
| --- | --- | --- |
| `local` | Development | Docker Compose: Postgres, grader, MailHog |
| `preview` | One per pull request | Lean stack, ephemeral database seeded from fixtures |
| `staging` | Pre-production, content review | Lean stack, anonymised copy of production |
| `production` | Live | Option A or B |

Staging exists mainly for the content team: authors need somewhere to see a template rendered in the real runner before it goes live, and that is not a job for a preview branch that disappears on merge.

### CI pipeline

On every pull request, in order, failing fast:

1. Typecheck, lint, dependency-boundary check (`packages/scoring` imports nothing)
2. Unit and property tests
3. Golden seed fixtures
4. Seed sweep across every live template
5. Build the web image and the grader image
6. Grader contract tests against the freshly built image
7. Playwright suite, including the hostile-client cases, against an ephemeral stack
8. CDK synth and diff, posted as a PR comment

Steps 3 and 4 are unusual and are the point: content is code here, and a content change that breaks an item should fail a build rather than reach a user.

### Deployment

**Option A:** merge to `main` → build → push to ECR → App Runner picks up the image. Migrations run as a one-off task before the image rolls. Rollback is redeploying the previous tag.

**Option B:** the same up to ECR, then CodeDeploy blue/green with a 10-minute bake and automatic rollback on the 5xx and latency alarms.

### Migrations

Drizzle, forward-only, run as a separate step before the application rolls. Every migration must be **backwards-compatible with the previous application version**, because both run simultaneously during any rolling deploy. Practically: add columns nullable, backfill in a job, tighten in a later release. Never rename in one step.

### Infrastructure as code

One CDK application, one stack, a `size` parameter selecting lean or robust constructs. No console changes — anything clicked in the console is lost at the next deploy and, worse, is invisible to the next person.

## 18. Risks and open questions

### Technical risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| **SymPy equivalence is wrong in an edge case** and a correct answer is marked wrong | Medium | Numeric probe fallback, shared contract fixtures, and the flag path with attempt reversal. This will happen; the recovery matters more than the prevention |
| **A degenerate instance reaches a user** from a bad parameter space | Medium | Seed sweep in CI over all live templates, plus discrimination monitoring |
| **Burstable CPU credits exhaust** under a traffic spike on Option A | Medium | CPU-credit alarm and a documented one-command resize to t4g.small |
| **The scoring module acquires a dependency** and replay silently diverges | Medium | Lint boundary, the replay-equivalence property test, and the staging trigger on `theta_after` |
| **The grader becomes a latency bottleneck** as symbolic content grows | Low at launch | Option B's warm tasks; measure submit p95 split by item type from day one |
| **A deletion request arrives** for a user whose responses underpin item calibration | Eventually certain | De-identification rather than deletion, stated in the privacy policy before launch |

### Open questions for the team

1. **Auth.js or Clerk?** Written here as Auth.js for cost and control. Clerk saves perhaps three days and adds a vendor. Decide in week one — it touches the schema.
2. **Does the admin tool live in the same Next.js app or its own?** Same app is assumed, on a gated route prefix. Separate is cleaner and doubles the deployment surface.
3. **Multi-step: one request per checkpoint, or one with progressive disclosure?** Assumed per-checkpoint, so each is independently claimable and recoverable.
4. **Do preview environments get a real grader or a stub?** A stub is cheaper; a real one catches contract drift earlier.
5. **Who carries the pager?** Option A's 99.5% target implies nobody does out of hours. That should be an explicit decision rather than an emergent one.

### Deliberately unresolved

Nothing here accommodates payments, teams or mobile. They are out of scope in the product spec and no extension points have been left for them — deliberately, because speculative seams are how a small system acquires the shape of a large one before it has the users to justify it.

## 19. The learning system

Implements product spec §19. Shared by both deployment options; nothing here changes the AWS designs in §14–§15.

### 19.1 Data model

| Table | Key columns |
| --- | --- |
| `lessons` | PK (skill\_id, version), title, est\_minutes, steps `jsonb`, key\_results `jsonb`, status, author\_id, reviewer\_id |
| `lesson_progress` | PK (user\_id, skill\_id), lesson\_version, status (`not_started · in_progress · completed · skipped`), current\_step\_id, first\_try\_checks, total\_checks, completed\_at |
| `lesson_step_events` | **append-only**: user\_id, skill\_id, lesson\_version, step\_id, event (`viewed · check_attempt · hint · reveal`), payload `jsonb`, created\_at |
| `remediation` | id, user\_id, skill\_id, cause (`failure_rate · repeat_misconception · demotion`), misconception\_id, created\_at, resolved\_at, resolution (`completed · skipped`) |

`steps` is `jsonb` for the same reason template payloads are: seven shapes, each validated by its own Zod schema on write. **Step ids are stable across lesson versions** where the step is unchanged, so a learner's progress survives a cosmetic edit.

Lesson checks are ordinary rows in `item_templates` with `usage = 'lesson'`. Every measurement query and index filters on `usage = 'practice'`, and item statistics are only ever computed for practice usage. That single column is the wall between learning and measurement, so it gets a database check constraint and a test (§19.9).

### 19.2 The boundary with scoring

Learn-mode events **never enter `packages/scoring`**. A second pure package, `packages/learning`, owns the teaching logic:

```ts
nextStep(lesson, progress): StepId | 'complete'
canComplete(lesson, progress): boolean       // every step seen, every check correct
entryBand(firstTryRate): 1 | 2                // ≥ 0.70 → 2
shouldRemediate(recent: Outcome[], misconceptions): Cause | null
refresherSteps(lesson, cause): StepId[]
lessonLift(completions, firstFive): number
```

There is exactly one exception, and it is routed rather than bypassed: completing a lesson can raise a skill to Familiar. That goes through `scoring.evaluateLevel(state, recent, { lessonCompleted: true })` — so there is still **one writer of levels**, and θ is untouched. The replay property (§12) continues to hold.

### 19.3 API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/lessons/:skill` | Current version, progress, resume point |
| `POST` | `/api/lessons/:skill/start` | Creates progress; returns the first step |
| `POST` | `/api/lessons/:skill/steps/:step/view` | Marks viewed; returns the next step |
| `POST` | `/api/lessons/:skill/steps/:step/attempt` | `{ raw }` → `{ correct, feedback, hintsRemaining, solutionAvailable }` |
| `POST` | `/api/lessons/:skill/steps/:step/hint` | Returns the next hint |
| `POST` | `/api/lessons/:skill/complete` | Server re-checks `canComplete`, sets Familiar and the entry band |
| `POST` | `/api/lessons/:skill/skip` | Status `skipped`; practice remains gated by prerequisites as normal |
| `GET` | `/api/lessons/:skill/steps/:step?review=1` | Deep link for targeted review from the answer screen |

Checks are **graded server-side** with the same code as practice — including the grader service for symbolic checks — and answers are not sent to the client. The stakes are low, but one grading path is simpler than two, and it keeps a curious user from reading every answer out of the page bundle. What checks do *not* get is the practice runner's machinery: no server clock, no single-claim update, retries allowed.

### 19.4 Session engine

The composer (§4) gains the lesson and refresher buckets from product spec §10.1. `session_items` gains `kind: 'item' | 'lesson' | 'refresher'`; a lesson or refresher occupies one slot in the plan and opens the player rather than the runner.

`shouldRemediate` runs inside the submit transaction, **after** scoring. If it fires, it writes a `remediation` row; the composer reads open rows when building the next plan and places the refresher ahead of that skill's practice items.

Two unlock queries replace one: *learn-unlocked* is every direct prerequisite at Level ≥ 1; *practice-unlocked* is every direct prerequisite at Level ≥ 2.

### 19.5 Maths rendering

KaTeX `renderToString`, server-side, at render time, with `throwOnError: false` and `errorColor` set to a sentinel class. The CI content sweep renders every template instance and every lesson step and **fails the build if the sentinel appears** — a malformed formula is caught in CI, never shown to a user.

Rendered HTML is cached per `(template, version, instance_hash)` and per `(lesson, version, step)`. KaTeX's CSS and a subset of its fonts are self-hosted, about 70 KB, because the CSP (§10) forbids third-party stylesheets. Emails use a small LaTeX-to-Unicode mapper for the common subset rather than rendered HTML.

### 19.6 Widgets

Four React components in `packages/widgets`, lazy-loaded so learners who never open an interactive step never download one. Each is:

- **Configured by lesson content**, validated by a Zod schema per widget.
- **Deterministic given a seed**, so the admin preview shows exactly what learners will see.
- **Simulated in a Web Worker**, with ceilings that keep a frame under \~50 ms on a mid-range laptop: 500 paths × 1,000 steps for the random walk, 200 paths × 500 bets for Kelly, 10,000 samples for the sampling explorer.
- **Drawn on canvas**, not SVG — hundreds of paths as SVG nodes will stutter.
- **Reduced-motion aware**: with `prefers-reduced-motion`, render the final state without animating.

### 19.7 Admin additions

A **lesson editor**: ordered step list, a form per step type, live KaTeX preview, widget preview with the seed, and the product spec §19.2 hard rules enforced as a pre-promotion gate — the lesson equivalent of the seed sweep. A **lesson health** view: completion, drop-off step, per-check first-try rate, lesson lift. Lessons follow the same versioning classes as templates (product spec §16). Because learning is unmeasured, a corrective change never replays θ; it only resets in-progress learners to the changed step.

### 19.8 Events

Add to §11: `lesson_started`, `lesson_step_viewed`, `lesson_check_answered` (first\_try, attempts, hints), `lesson_completed` (first\_try\_rate, minutes), `lesson_skipped`, `lesson_abandoned` (at\_step), `targeted_review_opened` (misconception), `refresher_triggered` (cause), `refresher_completed`, `refresher_skipped`.

### 19.9 Tests

- **Property: no learn-mode event stream can change θ, b, levels above 1, or any practice statistic.** Generate random streams of lesson events and assert scoring state is identical before and after. This is the test that keeps the three modes honest.
- Remediation triggers fire exactly at their boundaries — 3 of 5, twice in 10, on demotion — and not one attempt early.
- Hostile client: calling `/complete` without viewing every step or answering every check is rejected.
- Every lesson step and template instance renders through KaTeX without the error sentinel.
- Widgets render identically for the same seed.

### 19.10 Estimate

| Work | Engineer-days |
| --- | --- |
| Lesson player, seven step types | 4 |
| Four widgets | 4 |
| KaTeX pipeline and CI render check | 1 |
| Session engine: lesson and refresher buckets, remediation | 2 |
| Admin: lesson editor and lesson health | 2.5 |
| Lesson flagging into the shared queue | 0.5 |
| Review sheet and PDF export | 1.5 |
| Progress: skill map, over-time charts, history | 3 |
| Readiness snapshot job and table | 1 |
| Adaptive daily-plan email | 0.5 |
| Tests | 2 |
| **Total** | **\~22 days, about 4.5 engineer-weeks** |

This takes the build to about thirteen weeks for two engineers (product spec §15.1). With content now model-drafted, review finishes in about nine weeks, so **the build is the critical path**. The scheduling consequence: the lesson player (weeks 7–9) must land before the final lesson review on staging (weeks 9–11), or reviewers end up judging lessons as YAML rather than as learners see them.

### 19.11 Progress and history

Readiness is derived on read (§5), which is right for the present and useless for the past: yesterday's score cannot be recomputed without yesterday's state. So one derived value is stored purely for history:

| Table | Key columns |
| --- | --- |
| `readiness_snapshots` | PK (user\_id, date), readiness, provisional, validated, domain\_scores `jsonb`, status\_counts `jsonb` (locked · ready · learned · working · interview\_ready · fading) |

A nightly job writes one row per user active in the last 90 days, at 03:00 in the user's timezone. It calls `scoring.readiness()` exactly as the Home endpoint does, so a snapshot can never disagree with what the user saw that day. At 100 users it is trivial; at 50,000 it is a batched job in the worker service and still small. Placement completion and assessment completion also write an immediate snapshot, so the trend has a point at each event that mattered.

**Endpoints:**

| Method | Path | Returns |
| --- | --- | --- |
| `GET` | `/api/progress/map` | every skill: domain, tier, status, level, `r`, direct prereqs and dependents |
| `GET` | `/api/progress/history?days=90` | snapshots, plus sessions with type, counts and readiness delta |
| `GET` | `/api/learn/review-sheet` | key results of learned skills, grouped by domain |
| `GET` | `/api/learn/review-sheet.pdf` | the same, server-rendered to PDF |

**Tiers** are depth within the domain only — the longest chain of same-domain prerequisites — computed once per skill-graph version and cached. Cross-domain prerequisites are shown when a tile is selected but do not affect placement on the map; including them makes the lanes deep and sparse.

**Status** is derived: *locked* if any direct prerequisite is below Familiar; *ready* if Unseen and unlocked; otherwise the level; *fading* is an overlay when `r < 0.85`.

The review-sheet PDF renders KaTeX to HTML and prints it with a headless browser in the worker. Option A runs this in the jobs Lambda with a Chromium layer; Option B in the worker service. It is on-demand and cached per user per day.

### 19.12 Lesson flags

`flags` gains `target_type ('item' | 'lesson_step')` and a nullable `(lesson_skill_id, lesson_version, step_id)`. The admin flag queue shows both kinds; resolving a lesson flag produces a lesson version and moves in-progress learners, and never touches `responses` or θ — the property test in §19.9 already covers that.

### 19.13 The daily-plan email

The reviews-due job becomes a daily-plan job. It runs the session composer in dry-run mode for each opted-in user at 08:00 local time and sends if the plan contains at least one review **or** a lesson. The email body is built from the dry-run plan, so it cannot promise something the session will not deliver.
