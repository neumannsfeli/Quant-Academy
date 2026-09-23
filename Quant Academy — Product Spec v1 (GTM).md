# Quant Academy — Product Spec v1 (GTM)

Sep 16, 2026 · @Someone · Companion to the Figma UI spec

## What this document is

The original MVP spec described *what the product is*. The Figma file describes *what it looks like*. Neither says what happens when a user gets a question wrong — which number moves, by how much, and what that does to their score. This document closes that gap.

Every quantity visible in the UI has exactly one definition here, and every behaviour implied by a screen has a rule. The Figma file and this document are kept in agreement — where a number appears in both, it is the same number, and this document is the one that defines it.

Scope is the go-to-market v1: free at launch, desktop app with a mobile landing page, no payments.

**Not covered here:** database schema, API routes, framework choices, infrastructure, component architecture. Those belong in the build spec, which this document plus the Figma file should be enough to write.

## Decisions at a glance

Every open question, resolved. Details in the sections that follow.

| Question | Decision | § |
| --- | --- | --- |
| **How does someone learn a skill?** | **A guided path of 6–12 steps: concept, interactive, worked and faded examples, checks, a trap, key results.** | **19** |
| **Do lessons affect the score?** | **Never. Learn mode has hints and retries precisely because it is unmeasured.** | **19** |
| **Can a beginner start from zero?** | **Yes — "start with lessons" skips placement, and the daily plan stays lesson-led until 60% of required skills are learned.** | **19** |
| **What happens after repeated failure?** | **Targeted review of the tagged lesson step; a 5-minute refresher after 3 wrong in 5.** | **19** |
| **How do we know the lessons work?** | **Lesson lift: actual vs predicted correctness on a learner's first five practice attempts.** | **19** |
| How is ability modelled? | One θ per (user, skill), Elo-style logistic update. Item difficulty *b* co-updates. | 3 |
| What does a timeout score as? | Incorrect, full weight. No special case. | 3 |
| How does one skill inform others? | Correct answers propagate 15% of the update to direct prerequisites, upward only. | 3 |
| Which decay function? | Exponential on stability *S*. S₀ = 6 days, ×2.3 per pass, ×0.35 per fail. | 4 |
| When is a review due? | Predicted retention *r* < 0.85. | 4 |
| What if an interview date is set? | All intervals capped at half the remaining days. | 4 |
| How many levels? | Four: Unseen, Familiar (*learned*), Working and Interview-ready (*proved*). | 5 |
| What demotes a level? | Failing at band ≥ 3, or assessment recalibration. Decay alone never demotes. | 5 |
| How is readiness computed? | Blend of weighted mean (25%) and weighted power mean p = −4 (75%) over required domains. | 6 |
| When is readiness shown at all? | After 20 scored attempts and ≥ 5 in every required domain. Before that: provisional. | 6 |
| What does placement grant? | θ only — never a level, never cold-streak credit. ≥ 5 items per required domain. | 7, 18 |
| How many item types? | Five: numeric, MCQ with named distractors, symbolic, multi-step, timed drill. | 8 |
| Can MCQ options be text? | Yes — all numeric or all text, never mixed. Shuffled per instance. | 8 |
| How is a multi-step item scored? | Partial credit to θ; all-or-nothing for mastery. Wrong checkpoints reveal and carry. | 8 |
| How is a drill scored? | As one response, `y = k/N`, with Kᵤ scaled by set size. Mastery credit at ≥ 80%. | 8 |
| How are answers compared? | Numeric: float within tolerance. Symbolic: algebraic equivalence, numeric probe as fallback. | 8 |
| How is "already seen" detected? | By instance fingerprint — a hash of the sampled parameters — not by seed. | 8 |
| How is maths displayed? | LaTeX, rendered by KaTeX server-side. | 19 |
| Do we need a Python service? | Yes. SymPy grader for symbolic answers. Internal only. | 8 |
| What if the grader is down? | The item is voided, not marked wrong, and returns to the queue. | 8 |
| Who owns the clock? | The server. Client timing is advisory. | 9 |
| What is in a day's session? | One lesson when something is unlearned in the weakest area; any refreshers; then ≤ 40% reviews, 30% weakest-link, remainder new at p ≈ 0.75. | 10, 19 |
| How is a session sized? | In minutes (default 30), using median solve times and lesson estimates. | 10 |
| When does assessment unlock? | 8 skills at Working, or 14 days plus 100 scored attempts. | 10 |
| How much content? | 40 skills, 640 templates, 40 learning paths. \~169 person-days; \~85 of review with a model drafting. | 11 |
| Is an admin tool in scope? | Yes, including lesson health. On the critical path. | 12, 19 |
| Can we use questions from interview forums? | No. Original items only. | 13 |
| What is the north-star metric? | Share of signups reaching a validated readiness score within 21 days. | 14 |
| Which archetypes are live? | Puzzle/Trading, and Speed/Market-making reweighted. Research visible, not selectable. | 18 |
| How do users sign in? | Magic link or Google. No passwords. | 18 |
| What are the consent defaults? | Reminders on (service). Outcome sharing off (consent). No cookie banner. | 18 |
| Minimum age? | 16. | 18 |

## 3. The mastery model

### 3.1 Ability and difficulty

Each user holds one ability estimate **θ** per skill. Each item template holds one difficulty **b**. Both live on the same logistic scale, roughly −3 to +3.

Probability of a correct answer:

`p = 1 / (1 + exp(−(θ − b)))`

Difficulty bands are the authoring interface; *b* is the machine's version of the same thing. Every template is born at its band's prior and drifts from there as responses arrive.

| Band | Meaning | Prior b₀ |
| --- | --- | --- |
| 1 | Recall, one step | −1.2 |
| 2 | Standard textbook | −0.4 |
| 3 | Interview-typical | +0.4 |
| 4 | Hard interview, multi-step | +1.2 |
| 5 | Competition-grade | +2.0 |

### 3.2 The update

On every scored response, with `y = 1` for correct and `y = 0` for incorrect:

`θ ← θ + Kᵤ · c · (y − p)` `b ← b − Kᵢ · (y − p)`

**Kᵤ — user learning rate**, falling as the estimate firms up. `n` is the number of scored attempts on that skill:

- `n < 10` → 0.60
- `n < 30` → 0.35
- otherwise → 0.20

**Kᵢ — item calibration rate**, falling as the item accumulates evidence. `m` is the number of responses to that template:

- `m < 50` → 0.08
- otherwise → 0.02

**c — confidence multiplier** on the user update, because an uncalibrated item is weak evidence about a person:

- item has `m < 20` responses → `c = 0.6`
- the user has seen this seed before → `c = 0.25`, and no mastery credit (see §5)
- otherwise → `c = 1.0`

### 3.3 Timeouts

A timeout is scored as `y = 0` at full weight. It is stored with a `timed_out` flag so that speed analytics can separate "could not" from "too slow", but the ability update makes no distinction. This matches the product's central claim — under interview conditions, slow is wrong — and it avoids a special case that users would learn to exploit by stalling on items they expect to fail.

### 3.4 Prerequisite propagation

A correct answer is evidence about the prerequisites too. Someone who correctly applies the optional stopping theorem demonstrably knows what a martingale is.

On a correct response only (`y = 1`), each **direct** prerequisite of the answered skill receives:

`θ_prereq ← θ_prereq + 0.15 · Kᵤ · (y − p)`

One hop only, no recursion, and never on failure — a wrong answer on a hard skill says nothing reliable about its foundations. This is what lets a 24-item placement produce a plausible picture across 24 skills, and what keeps the map filling in during normal use rather than requiring the user to grind every node.

### 3.5 Storage

Every response is written immutably with: user, skill, template, seed, submitted answer, correctness, server-measured elapsed ms, timeout flag, θ before and after, b before and after, predicted p, session id, mode (practice / assessment / placement). This log is the product's only durable asset and the thing that makes later recalibration possible. It is never updated in place, only appended.

## 4. Retention and decay

### 4.1 The function

Each (user, skill) carries a **stability** *S*, in days. Predicted retention *t* days after the last successful attempt:

`r(t) = exp(−t / S)`

This is the number shown as `r 0.81` throughout the UI, and the thing the ring around a skill node encodes.

### 4.2 Constants

- **S₀ = 6 days** on the first correct answer. This puts the first review about one day later, which is where it belongs.
- **On a successful review:** `S ← S × 2.3` if answered inside the time limit, `S × 1.6` if over it. Slow-but-correct earns a shorter leash.
- **On a failure:** `S ← max(2, S × 0.35)`. Never below two days; a skill that keeps failing should not be served daily forever, it should be sent back to the lesson.
- **Ceiling:** S capped at 180 days.

The resulting ladder for a user who keeps passing inside the limit: **1 day → 2.3 → 5.3 → 12 → 28 → 64 → 148**.

### 4.3 When a review is due

A skill enters the review queue when `r(t) < 0.85`. Solving `exp(−t/S) = 0.85` gives `t = 0.163 · S`, so with S₀ = 6 the first review lands at day 0.98 and each subsequent multiplication of S moves the next review by the same factor, producing the ladder above. The threshold and S₀ are chosen together — changing 0.85 without changing S₀ changes every interval in the product.

Overdue items are ordered by `0.85 − r` descending, so the most decayed surfaces first.

### 4.4 Interview-date compression

If the user has set an interview date, every scheduled interval is capped:

`interval ← min(interval, max(1, days_until_interview / 2))`

A review scheduled 64 days out when the interview is in 20 days is useless. This rule pulls it to day 10, guaranteeing at least one more exposure before the date that matters. If the interview date has passed, the cap lifts and normal spacing resumes.

### 4.5 Decay does not demote

Retention and level are **separate axes** and the UI encodes them separately — fill colour for level, ring for retention. A skill that reached Interview-ready and then decayed to `r = 0.62` is still Interview-ready; it is simply overdue. Only a *failed* attempt demotes it (§5.2).

This is a deliberate choice. Conflating the two would mean a user who took a week off logs in to find their score has collapsed through no failure of their own, which is both demoralising and untrue — they have not got worse, they are just rusty. Retention feeds the review queue and dampens the readiness score (§6.1); it does not rewrite history.

## 5. Levels

Four levels. Level 4 ("Fluent") from the original spec is cut: it required two spaced reviews at least 14 days apart, which is unobservable in the first month of a product's life and therefore cannot influence anything at launch.

### 5.1 Promotion

| Level | Name | Criteria |
| --- | --- | --- |
| 0 | Unseen | Nothing started: no scored attempts, learning path not completed. |
| 1 | Familiar — *learned* | Completed the skill's **learning path** (§19.4) — every step seen, every check answered correctly, retries allowed — **or** at least one correct scored practice answer at any band. |
| 2 | Working — *proved* | θ ≥ 0.1 **and** ≥ 3 scored attempts **and** ≥ 60% correct across the last 5. |
| 3 | Interview-ready — *proved cold* | Three consecutive correct answers on **unseen instances** at band ≥ 3, each inside its time limit, **and** r ≥ 0.80 at the moment of evaluation. |

The ladder now spans the whole journey: Familiar is **learned**, Working and Interview-ready are **proved**. Opening a lesson no longer counts for anything.

The θ ≥ 0.1 threshold for Working is deliberately the band-3 prior (0.4) minus 0.3 — it means "would more likely than not handle an interview-typical question", without yet having proved it cold.

The Level 3 streak counter is the `cold streak 2 → 0` shown on the answer screen. It resets on any failure, any timeout, any repeated seed, and any attempt below band 3. It does **not** reset through mere decay.

### 5.2 Demotion

Nothing in the original spec said how a user loses a level, which means a single lucky streak would have pinned someone at Interview-ready forever. Three routes down:

1. **Failed review at band ≥ 3** — Interview-ready → Working. Cold streak resets to zero. One failure is enough; the whole claim of the level is that you can do it cold, and you just did not.
2. **Two consecutive failures at band ≥ 3** — Working → Familiar.
3. **Assessment recalibration** — if performance during a timed assessment implies a θ more than 0.6 below the stored value, shrink toward the observed estimate: `θ ← 0.5·θ + 0.5·θ_observed`, then re-evaluate the level against §5.1 and demote if it no longer holds.

Route 3 is the mechanism behind the *"held Level 3 on 4 mental-math nodes but failed cold items on 3 of them"* copy in the assessment report. It is the product's self-correction: practice conditions are always slightly easier than test conditions, so without a periodic hard reset the scores drift optimistic.

### 5.3 Why levels and retention stay separate

Level answers *have you ever demonstrated this cold?* Retention answers *is it fresh right now?* A user can be Interview-ready and overdue; that is a perfectly coherent state and the UI shows it as a green node with a partly-empty ring. Merging them into one number would destroy the only diagnostic that tells a user whether to review or to learn.

## 6. The readiness score

This is the number the whole product is named around. It has to be defensible, stable enough not to yo-yo, and brutal enough to keep meaning something.

### 6.1 Skill score

For each skill *i* that the user's profile marks as required:

`cᵢ = 100 · σ( 1.1 · (θᵢ − b_req) )`

where `σ` is the logistic function and `b_req` is the difficulty prior of the band that profile requires for that skill (band 3 for most, band 4 for skills flagged as core to a speed profile).

Then dampen by freshness and cap by demonstrated level:

`cᵢ ← cᵢ · (0.6 + 0.4 · rᵢ)`

| Level | Cap on cᵢ |
| --- | --- |
| 0–1 | 55 |
| 2 | 80 |
| 3 | none |

The caps are what stop a user who has never once performed cold from showing a high score on the strength of a favourable θ.

### 6.2 Domain score

`D_d = Σ(wᵢ · cᵢ) / Σ wᵢ` over required skills in the domain, where `wᵢ` is the skill's importance weight (1–3, set at authoring time).

### 6.3 Readiness

Let `W_d` be the profile's domain weights (they sum to 1). Readiness blends an arithmetic mean with a strongly min-seeking power mean:

`M = Σ W_d · D_d` `P = ( Σ W_d · D_d^(−4) )^(−1/4)` `R = round( 0.25·M + 0.75·P )`

The power mean with exponent −4 behaves almost like a minimum but stays smooth and differentiable, so the score moves continuously as the weakest domain improves instead of jumping when the ranking changes. The 25% arithmetic component stops a single catastrophic domain from pinning the score at near-zero and making all other progress invisible.

### 6.4 Worked example

Using the domain scores shown on the Home screen (82, 61, 55, 24) with Puzzle/Trading weights (0.40, 0.25, 0.20, 0.15):

- `M = 62.7`
- `P = 37.6`
- `R = 0.25(62.7) + 0.75(37.6) = **44**`

A 24% weakest domain produces a score in the forties even with a strong 82% elsewhere, which is the whole point of the weighted minimum: the arithmetic mean of those four figures is 63, and a product that reported 63 would be flattering the user in exactly the way this one exists to prevent.

### 6.5 Provisional state

Readiness is suppressed and shown as `—` until **both**: ≥ 20 scored attempts total, and ≥ 5 scored attempts in every required domain. Until then the UI shows the provisional banner from the edge-states frame. A score computed from four data points would be noise presented as authority.

### 6.6 Weakest link

The named weakest link is `argmin_d D_d` over required domains, ties broken by the larger `W_d`. It drives the red callout on Home, the 30% weakest-link allocation in session composition (§10.1), and the headline sentence on the session summary.

### 6.7 Validation

A readiness score is **validated** for 21 days after a passed assessment, and **unvalidated** otherwise. The UI states which. Unvalidated scores are still shown — they are still the user's best estimate — but the assessment card stays visible and the wording on the score never claims more than practice conditions support.

## 7. Placement

24 items, roughly 20 minutes, adaptive. Its only job is to seed θ so that the first real session is aimed correctly.

### 7.1 Algorithm

Each domain nominates a **hub skill** — the one with the most outgoing prerequisite edges (Counting & combinatorics, EV & fair value, Random walks, Anchoring & rounding). Placement allocates **at least 5 items to every required domain**, then distributes the remainder by profile weight. Five is not arbitrary: it is the per-domain threshold for a non-provisional score (§6.5), so completing placement always produces a real readiness number — which is what the sign-up screen promises.

Within a domain:

1. Serve a band-2 item on the hub skill.
2. Correct → next item one band up. Incorrect → one band down, floor of band 1.
3. Update θ normally (§3.2) with `Kᵤ = 0.6` throughout, since every estimate starts uninformed.
4. After the third item in a domain, switch from the hub to the skill with the widest uncertainty — in practice, the least-attempted required skill whose prerequisites are satisfied.

Stop at 24 items or when the user quits. **A partial placement is kept**, exactly as the first-run card promises: every answer given has already updated θ, and nothing is discarded on abandonment.

### 7.2 Seeding unattempted skills

After placement, every required skill with no direct evidence receives:

`θ = mean(θ over attempted skills in the same domain) − 0.3`

flagged `inferred`. Inferred skills keep `Kᵤ = 0.6` until their third real attempt, so the first genuine evidence moves them hard. The −0.3 penalty biases the product toward under-claiming, which is the right direction for a tool whose value proposition is honesty.

### 7.3 What placement does not do

**Placement never grants a level.** It sets θ and nothing else. Every skill stays at Unseen until the user opens a lesson or answers correctly in a normal session.

This matters more than it looks. If placement could hand out Working or Interview-ready, the readiness score would be built on twenty minutes of guessing, and the first assessment would tear it down — which is a worse experience than starting honestly low and climbing. It also keeps the promise on the landing page intact: mastery is earned on unseen items, not inferred.

### 7.4 Skipping

Skipping is allowed and is offered on the first-run screen. Consequences: every skill starts Unseen with `θ = −0.5` (a mild pessimistic prior), the score stays provisional until the §6.5 thresholds are met, and the provisional banner explains why. The recommender still works — it simply spends the first two sessions doing what placement would have done in twenty minutes.

## 8. The item system

### 8.1 Five item types

| Type | What it asks for | Graded by |
| --- | --- | --- |
| **Numeric** | A number, typed. No options to eliminate. | Node |
| **MCQ, named distractors** | One of four options, three tied to documented errors. | Node |
| **Symbolic** | An expression — a closed form, a distribution, a bound. | Python grader |
| **Multi-step** | 2–5 checkpoints, each numeric or symbolic. | Node + grader per checkpoint |
| **Timed drill** | A set of N short items under a single clock. | Node |

Each earns its place by measuring something the others cannot.

**Numeric** is the workhorse: a constructed response with nowhere to hide. **MCQ** exists for the diagnosis — when the wrong answer is an option you chose deliberately, the misconception is unambiguous. **Symbolic** is the only way to ask for a *derivation's result* rather than a number, which is what most stochastic and derivatives questions actually want. **Multi-step** measures whether a candidate can hold a four-stage argument together, which is exactly the thing a numeric item cannot distinguish from a lucky guess. **Timed drill** is the mental-math instrument: twenty two-digit products in two minutes measures something no single item does, because the skill being tested is throughput.

### 8.1.1 Multi-step: partial credit and carried values

A multi-step item presents its checkpoints one at a time. On a wrong checkpoint the correct intermediate value is revealed and the item continues, with that step marked `carried`. Without this, one arithmetic slip at step 1 destroys an item that would have taught three further things, and the user learns nothing but frustration.

Scoring is split:

- **Ability update** uses partial credit: `y = (checkpoints correct) / (total checkpoints)`, a fractional outcome in the §3.2 update.
- **Mastery credit** is all-or-nothing: a multi-step item only advances the Level 3 cold streak if every checkpoint was correct unaided, inside the total limit.

### 8.1.2 Timed drill: scoring a set

A drill template declares a generator, an item count, and one total time limit. The user answers in sequence with no back navigation; the clock runs across the whole set.

- Raw result: `k` correct out of `N` within the limit.
- **Ability update:** treat as a single response with `y = k/N`, and `Kᵤ` scaled by `min(1, N/10)` — a twenty-item drill is stronger evidence than a single question and should move θ accordingly.
- **Mastery credit:** the drill counts as one clean cold attempt if `k/N ≥ 0.8`.

Drills are the only item type where the clock is the whole point rather than a constraint, which is why the pass fraction is a tunable (§20) rather than a fixed rule.

### 8.1.3 The grader service

Symbolic and multi-step-with-symbolic-checkpoints need algebraic equivalence, which Node cannot do honestly. That means a **Python service** — FastAPI, SymPy, stateless, internal network only, no user data beyond expression strings.

It is a second deployment target and a second thing that can be down. The failure policy matters more than the service:

**If the grader is unavailable or times out, the item is voided, not marked wrong.** The response is stored with `ungraded`, θ is untouched, the user is told the item could not be scored and that it will not count, and the item returns to the queue. A user penalised because our container restarted would be exactly the injustice this product claims to eliminate.

Timeout is 2 seconds per expression. Input is parsed with a restricted SymPy parser — no imports, no dunder attributes, no arbitrary function calls, expression depth capped.

### 8.2 Template schema

```
ItemTemplate {
  id                string          // "{skill_id}.b{band}.{slug}"
  version           int
  skill_id          string
  band              1..5
  type              "numeric" | "mcq" | "symbolic" | "multistep" | "drill"
  importance        1..3            // feeds the readiness weight
  params            Param[]         // sampled in declared order; may be empty
  constraints       string[]        // boolean expressions over params
  stem              string          // REQUIRED for every type. For drills it is
                                    // the instruction line above the set
  time_limit_sec    int             // total, for multistep and drill
  solution_steps    string[]        // templated, revealed post-answer
  status            "draft" | "in_review" | "live" | "retired"
  author, reviewer, created_at, reviewed_at

  // numeric
  answer            string          // expression over params
  tolerance         { abs: 1e-9, rel: 1e-6 }
  unit              "none" | "percent" | "currency"
  near_miss         [ { expr, misconception_id } ]

  // mcq — options are EITHER all numeric OR all text
  answer            string          // numeric MCQ: expression
  answer_label      string          // text MCQ: the correct option's wording
  distractors       [ { expr | label, misconception_id } ]   // exactly 3
  display           { format: "number" | "percent", decimals: int }

  // symbolic
  answer_expr       string          // canonical form, in terms of params
  variables         string[]        // free symbols the user may use
  domain_hints      [ { var, assume } ]   // "positive integer", ...
  equivalence       "algebraic" | "numeric_probe"
  tests             { accept: string[], reject: string[] }  // authoring only

  // multistep
  checkpoints       [ {
                        prompt, kind: "numeric" | "symbolic",
                        answer | answer_expr, tolerance?,
                        reveal_on_fail: true,
                        near_miss?
                     } ]            // 2..5

  // drill
  drill             {
                      count: int,           // items in the set
                      total_sec: int,
                      pass_fraction: 0.8,
                      item: { params, constraints, stem, answer, near_miss? }
                    }
}

Param {
  name, type: "int" | "float" | "choice",
  min, max, step | values[]
}
```

**Text-option MCQ.** Conceptual questions — *what happens to the fair value of your position after an informed counterparty lifts you?* — have wording, not numbers, as options. They use `answer_label` and `label` on each distractor. Options are shuffled per instance using the seed, so position carries no information. A template may not mix numeric and text options.

### 8.3 Seeding

An **instance** is `(template_id, seed)`. Generation is deterministic: seed a xorshift128 PRNG with `hash(template_id, seed)`, sample parameters in declared order, evaluate constraints, resample on failure up to 50 attempts, then error out and flag the template as over-constrained.

Determinism is not a nicety — it means the response log stores a 4-byte seed rather than a rendered question, every past item can be reconstructed exactly for dispute resolution, and the same instance can be replayed to a reviewer.

**Seen-seed rule:** an instance the user has seen within 90 days is never served for mastery credit. The scheduler prefers a never-seen instance; if the template's parameter space is exhausted, it moves to a different template on the same skill and band.

### 8.4 Answer checking

**Numeric.** Normalise, then compare. The parser accepts digits, `+ - * / ^ ( )`, a decimal point, and the constants `pi` and `e`. It strips whitespace, thousands separators and currency symbols, and rejects everything else — no variables, no function calls, no exponent towers beyond a depth cap.

Accept if `|submitted − answer| ≤ max(tol.abs, tol.rel · |answer|)`.

With defaults `abs = 1e-9`, `rel = 1e-6`: `27/4`, `6.75`, `6.750` and `6.75000001` all match; `6.7` does not. Templates whose answer is a round-number estimate (Fermi problems) override `rel` to something like 0.15 and say so in the stem.

**Symbolic.** Parse with a restricted SymPy parser under the template's `domain_hints`, then test `simplify(submitted − answer_expr) == 0`. If `simplify` exceeds its budget, fall back to a **numeric probe**: evaluate both expressions at 20 random points in the declared domain and accept if every pair agrees within 1e-9 relative. The probe is what makes symbolic grading tractable in practice; pure symbolic equivalence is undecidable in general and slow in particular.

Rejected before evaluation: unbound symbols not in `variables`, expressions over the depth cap, anything containing `__`, and any input over 512 characters.

**Multi-step.** Each checkpoint is graded by its own kind as above, in order. A failed checkpoint reveals its correct value and the item continues from there (§8.1.1).

**Drill.** Each of the N sub-items is numeric and graded as above. The set is scored as a whole (§8.1.2). Sub-items answered after the clock expires are discarded, not marked wrong — the drill's measure is throughput inside the window.

**Empty submission is a submission** and scores as incorrect, for every type. There is no way to pass on an item, because in an interview there is no way to pass on a question.

### 8.5 Misconceptions

A misconception is a first-class record, not a string on an item:

```
Misconception { id, skill_id, name, explanation, sample_trigger }
```

`name` is the machine-ish label shown to the user (`max-equals-n-times-mean`). `explanation` is the paragraph on the answer screen. Every MCQ distractor references one. Numeric items may optionally declare **near-miss rules**: an expression plus a misconception id, checked when the answer is wrong, which is what lets a typed numeric answer of 13.5 be diagnosed rather than merely rejected.

This is the mechanism behind the whole diagnosis story on the answer screen and in the session summary, and it is authored effort, not inference. Budget for it: writing three genuinely plausible distractors is harder than writing the question.

## 9. Timing and integrity

The clock is not a feature here, it is half the measurement. A client-side timer would be defeated in an afternoon by exactly the people this product is for.

### 9.1 Server-authoritative clock

1. Client requests the next item. The server mints a `session_item` row with `served_at` from the server clock and returns the rendered stem, the parameters, and the time limit — **and nothing else**.
2. Client submits an answer, optionally including its own measured elapsed time.
3. The server computes `elapsed = now − served_at` and uses **its own value** for scoring. The client figure is stored only so that large discrepancies can be detected and investigated.
4. `elapsed > time_limit + 2s` → scored as a timeout (incorrect, §3.3). The two-second grace absorbs network latency.

### 9.2 What the client never receives

The correct answer, the solution steps, the misconception explanations, and — for MCQ — which option is correct, are **never** sent before submission. They are returned in the response to the submission itself. Anything in the page bundle is visible to the user, and this audience will open the network tab.

### 9.3 One submission per item

The server refuses a second submission for the same `session_item`. Refresh, back button and duplicate requests all resolve to the first submission. This is what makes "no going back" real rather than a UI convention.

### 9.4 Abandonment

An item served and never answered is resolved at session close, or by a sweeper after `time_limit + 5 minutes`, whichever comes first. It scores as a timeout. Without this rule a user could farm mastery by abandoning every item they did not immediately recognise.

### 9.5 Practical limits

None of this stops someone using a second device, a calculator, or a friend. It does not need to — the product's failure mode is a user deceiving themselves, and the honest framing on the landing page and in the assessment copy does more work there than any technical control could. What server-authoritative timing does stop is the **accidental** invalidation of the dataset, which is the thing that would actually destroy the product's long-term value.

## 10. The session engine

### 10.1 Composition

A session targets the user's daily item count (default 24, settable 8–60). It is assembled in three buckets:

| Bucket | Share | Source |
| --- | --- | --- |
| **New lesson** | at most one per session, counted at its estimated minutes | The topologically-first unlearned skill whose prereqs are all Familiar, in the weakest required domain. Included while fewer than 60% of required skills are Familiar, or whenever the weakest domain has one waiting (§19.7) |
| **Refresher** | \~5 min, ahead of practice on that skill | Any skill flagged for remediation (§19.6) |
| Due reviews | up to 40% of the remaining time | skills with `r < 0.85`, ordered by `0.85 − r` descending, weighted by domain weight × importance |
| Weakest link | 30% of the remaining time | unlocked skills below Level 3 in the lowest-scoring required domain |
| New / advancing | remainder | unlocked skills, item chosen so predicted `p` is closest to 0.75 |

A beginner's day is lesson-led; an experienced user's is practice-led. The same rule produces both.

If the review backlog exceeds twice the daily target, the review cap rises to 60% and the new-material bucket shrinks. Reviews are the only bucket allowed to starve the others, because a collapsing retention curve invalidates every score already earned.

If a bucket cannot be filled — no reviews due, nothing unlocked in the weak domain — its share redistributes to new material. If *nothing* can be served, the empty-queue edge state appears.

### 10.2 Band selection

- **New material:** the band whose predicted `p` is nearest 0.75. Deliberately below the \~0.85 that the spacing literature favours for retention, because interview preparation is not only about retention — a user who is never uncomfortable never finds out where the wall is.
- **Reviews:** the band at which the skill was last passed. A review should test the claim already made, not extend it.
- **Level-3 attempts:** band ≥ 3, forced, since that is the promotion criterion.

### 10.3 Hard constraints

1. **Prerequisite gate.** Never serve a skill unless every direct prerequisite is at Level 2 or above. This is the knowledge graph doing its work without being drawn.
2. **Interleaving.** No two consecutive items from the same skill. No more than three consecutive from the same domain. Blocked practice inflates in-session accuracy and destroys transfer, which would corrupt the readiness score in the flattering direction.
3. **No repeated seeds** within 90 days (§8.3).
4. **Time budget.** The daily target is set in **minutes** (default 30), not items. The engine adds items until their summed **median solve time** reaches the target, using each template's observed median from `item_stats`, or 50% of its time limit until it has 30 responses. Time limits are a per-item ceiling, not a planning estimate — budgeting on them would cap a 30-minute session at around ten items. The item count shown on Home is computed from this, not configured.

### 10.4 Assessment mode

Same runner, different parameters. The mode chip in the top bar is the only visible difference.

|  | Practice | Assessment |
| --- | --- | --- |
| Length | \~24 items | 45 min, \~34 items |
| Bands | adaptive to p ≈ 0.75 | fixed 3–4, weighted by profile |
| Composition | three buckets | proportional to domain weights |
| Solutions | after each item | after the whole assessment |
| Pausing | between items | none |
| Effect on θ | normal | normal, plus shrinkage (§5.2 route 3) |

**Unlock:** 8 skills at Working or above, **or** 14 days since signup with ≥ 100 scored attempts. The second path exists so a slow-but-steady user is not locked out of the product's headline moment indefinitely.

**Pass:** composite ≥ 65% **and** no required domain below 40%. The second clause is the weakest-link principle applied to the test itself — you cannot pass by being excellent at three domains and absent in the fourth.

**Cadence:** at most once per 14 days. Validation lasts 21 days (§6.7), so a user who wants to stay validated takes one roughly every three weeks.

## 11. Content plan

This is the largest single cost in the project. It is bigger than the application build, it is on the critical path, and it does not compress by adding engineers — only by adding people who can write and verify quant problems.

Full scope: **40 skills, all five bands, all five item types.**

### 11.1 How much content a single user consumes

Taking one skill from Unseen to Interview-ready costs roughly 8–15 items: a few to establish θ, three consecutive clean ones at band ≥ 3, and the failures in between. Add reviews at the §4.2 ladder and a committed user burns **\~25 instances per skill over 90 days**.

Parameterisation does most of the work — one template with a well-chosen parameter space yields many instances that feel distinct. It does not yield unlimited ones: a user who meets the same *stem* with different numbers five times in a fortnight notices, and rightly concludes the product is thinner than advertised.

**Target: ≥ 4 templates per (skill, band) for bands 2–4, ≥ 2 for bands 1 and 5.** Sixteen templates per skill.

### 11.2 The library

**40 skills × 16 templates = 640 templates**, plus 40 lessons.

Type mix across the library, weighted toward the bands where each type does its work — drills cluster at bands 1–2, symbolic and multi-step at 4–5:

| Type | Share | Templates |
| --- | --- | --- |
| Numeric | 40% | 256 |
| MCQ, named distractors | 25% | 160 |
| Multi-step | 20% | 128 |
| Symbolic | 10% | 64 |
| Timed drill | 5% | 32 |

Drills are few in number and large in coverage: one drill template with a good generator carries an entire mental-math sub-skill on its own.

### 11.3 Authoring throughput

A template is not written in ten minutes. Each needs a stem that reads like an interview question, a parameter space checked for degenerate cases, a verified answer, distractors or checkpoints, and solution steps that survive parameter substitution. Rates differ sharply by type:

| Type | Rate | Volume | Person-days |
| --- | --- | --- | --- |
| Numeric | 10/day | 256 | 26 |
| MCQ | 8/day | 160 | 20 |
| Multi-step | 4/day | 128 | 32 |
| Symbolic | 8/day | 64 | 8 |
| Timed drill | 3/day | 32 | 11 |
| **Templates total** |  | **640** | **97** |
| **Learning paths** — steps, examples, trap, \~6 checks each (§19.2) | \~1.5 days each | 40 | **60** |
| Misconception library |  | \~100 entries | 7 |
| Skill graph, prereqs, weights |  | 40 skills | 5 |
| **Total** |  |  | **\~169 person-days** |

Multi-step is the expensive one — four checkpoints means four answers to verify and four failure paths to write — and at 128 templates it consumes a quarter of the entire content budget on its own. It is worth it, because it is the only type that measures sustained reasoning, but it should be sequenced late enough that the cheaper types are already carrying the product.

### 11.4 What that means for staffing

**\~169 person-days is roughly 34 person-weeks** of human authoring. With a model drafting, as now planned, the constraint becomes review — budget roughly half: **\~85 person-days of qualified review**, which is still the critical path. The realistic shapes for the review load:

| Reviewers | Calendar, model-drafted |
| --- | --- |
| 1 | \~17 weeks |
| **2** | **\~9 weeks** |
| 3 | \~6 weeks |

Three is the recommendation: a lead who owns the skill graph, the misconception library and final review, plus two contract authors with quant backgrounds working from LLM drafts. Contractors of this kind are findable — recent graduates of the exact programmes this product serves, who have just sat these interviews and know which errors are real.

**Content hiring starts before the build does.** It is a nine-week lead time on the critical path, and every week it is delayed is a week added to launch.

### 11.5 Ongoing rate

After launch, budget **\~30 templates per week** to stay ahead of the most active users, replace retired items, and extend the two stub domains. This is a permanent role, not a project.

### 11.6 Generation pipeline

LLM drafts against a structured prompt per (skill, band, type) carrying the skill definition, that skill's misconception library, and three exemplar templates of the same type. Output lands at `draft`. A human reviewer verifies the answer, runs the automated seed sweep (§12.2), rewrites the distractors and checkpoints — where the model is weakest and where the product's differentiation actually lives — and promotes to `live`.

Nothing reaches a user at `draft`. The review step is not a rubber stamp and must not be estimated as one; the day rates above already assume a competent reviewer working from good drafts.

## 12. Admin and authoring tool

Not optional, not a phase two, and not a spreadsheet. The product cannot be operated without it: the flag button designed on the answer screen is a promise that somebody is on the other end, and there is no way to honour that promise through a database client.

It is internal-only, ugly-is-fine, behind a separate auth check. Five surfaces:

### 12.1 Template editor

Fields per §8.2, plus a **live preview** that renders five random seeds side by side so the author can see the parameter space rather than imagine it.

### 12.2 The seed sweep

One button, run before anything can be promoted to `live`. It generates 200 instances and refuses promotion on any of:

- an answer that is `NaN`, infinite, or throws
- constraints unsatisfiable within 50 resamples
- fewer than 20 distinct answers across 200 seeds — **for numeric, MCQ, multi-step and drill only**. Symbolic answers are expressions and templates with no parameters have one instance by design; both are exempt, and zero-parameter templates are instead flagged so reviewers know the instance repeats
- **two MCQ options that render identically at display precision** for any seed — compared on the rendered strings, not raw values, because 0.9301 and 0.9349 are both "93%" to a user. The single most common and most damaging authoring bug
- answers whose magnitude spans more than six orders of magnitude (usually a degenerate parameter range)
- for symbolic templates: any `tests.accept` expression graded wrong, or any `tests.reject` expression graded right

This check is cheap to build and catches the errors that would otherwise reach users and cost trust.

### 12.3 Review queue

Everything at `in_review`, oldest first. Approve, send back with a note, or discard. Records reviewer and timestamp on the template, because content provenance is a legal question as well as a quality one (§13.4).

### 12.4 Flag queue

User flags with the exact instance attached — template plus seed, so the reviewer sees precisely what the user saw, reconstructed deterministically (§8.3). Actions: dismiss, edit, or retire.

**Retiring is immediate and retroactive.** The item stops being served, and every response to it is marked `void` and excluded from θ history. The answer screen tells the user their attempt has been reversed; that has to be true, and it is what makes flagging safe enough that people actually do it.

### 12.5 Item health

Per template, once it has ≥ 30 responses:

- **p-value** — proportion correct. Healthy range 0.35–0.85 for its band.
- **Discrimination** — point-biserial correlation between getting this item right and overall session performance. **Negative discrimination means stronger users get it wrong more often than weaker ones**, which almost always signals an ambiguous stem or a wrong answer key. Auto-flag below 0.
- **Mean time vs limit** — a limit that almost nobody meets is mis-set.
- **Flag rate** — auto-retire above 5%.
- **b drift** — the distance the item has moved from its band prior. Large drift means it is mis-banded; the band should be corrected so that band selection (§10.2) keeps working.

## 13. Supporting surfaces

### 13.1 Email

Four templates, and no more. Every one of them is promised by a toggle in Settings or required by law.

| Email | Trigger | Notes |
| --- | --- | --- |
| Verify & welcome | signup | Single link straight into placement |
| Desktop handoff | mobile landing capture | One email, no sequence. The mobile page promises exactly this |
| Reviews due | daily, if anything is waiting — reviews due **or** a lesson in the plan — and the toggle is on (§19.13) | Sent at 08:00 in the user's timezone — this is why Settings carries a timezone field |
| Weekly summary | weekly, toggle off by default | What moved, what is fading, one line on standing |

A fifth, the **outcome ask**, fires 7 days after a user-entered interview date if the outcome-sharing toggle is on. It is the calibration pipeline (§14.4) and should be written as a question from a person, not a survey.

### 13.2 States every screen needs

- **Loading** — skeletons on Home and Progress; the session runner and lesson player block on fetch and must never show a stale item or step.
- **Validation** — inline, on submit, on every form field in signup and settings.
- **Offline / request failure mid-session** — hold the answer locally, retry, and if it cannot be delivered, tell the user the item was not scored rather than silently dropping it.
- **404 and 500** — with a route back to Home.
- **Session resume, empty review queue, provisional score, item flagged** — designed in the edge-states frame.

### 13.3 Legal pages

Privacy policy, terms, and a **content and sources** page. Account deletion and data export are built (they are in Settings) and are a GDPR obligation, not a nicety, the moment a European user signs up — which on day one of a public launch is certain.

### 13.4 Content sourcing — a real risk

**Do not use questions collected from Glassdoor, interview-experience forums, or firms' own past papers.** Not paraphrased, not "inspired by". Two separate problems: the compilations are themselves copyrighted, and building a commercial product on questions lifted from named firms invites a letter from those firms that a pre-revenue company cannot afford to answer.

The defensible position, and the one the Content & sources page should state plainly: **every item is original, written against public mathematical archetypes** — order statistics, optional stopping, Kelly sizing — which are textbook material that nobody owns. "Jane Street-style" describes a *type* of reasoning, and that is the only sense in which firm names should ever appear in content. Firm names on the landing page and in the archetype picker describe who the user is preparing for, which is fine; firm names attached to individual questions are not.

## 14. Instrumentation

### 14.1 North star

**Share of signups who reach a validated readiness score within 21 days.** It is the only metric that requires the whole product to work: onboarding, content, the mastery model, retention, and the assessment. Optimising it cannot be faked by growth tactics.

### 14.2 Funnel

| Step | Target |
| --- | --- |
| Landing → signup | 8% |
| Signup → placement complete | 60% |
| Placement → second session | 45% |
| Second session → 8 skills at Working | 25% |
| → assessment attempted | 18% |
| → assessment passed | 12% |

These are stakes in the ground, not forecasts. Their job is to make the first cohort's numbers interpretable — a 20% landing conversion means the page is doing something remarkable, and 2% means it is not being read.

### 14.3 Item and model health

- p-value distribution across live items, centred near 0.75 for material served as new
- flag rate below 1.5% of responses
- median session length 22–35 minutes against a 30-minute target
- **Brier score** on predicted `p` versus outcome, logged for every response
- calibration curve: bucket predictions into deciles and plot predicted against actual

The Brier score is the honest measure of whether the mastery model works at all. If predictions are no better than a constant, θ is decorative and the readiness score is a fiction — that finding would be unwelcome and is exactly why it must be instrumented from day one rather than discovered later.

**Monthly recalibration:** refit the band → `b₀` mapping from observed data. The priors in §3.1 are a guess; after a month of responses they should be replaced by measurement.

### 14.4 Outcome capture

The closing of the loop, and the reason the launch is free.

Sources: the Settings toggle, the post-interview email (§13.1), and a one-question prompt on Home if an interview date has passed. Captured: firm, stage, outcome, and the user's readiness score at the time.

Target **50 outcomes** before making any public claim about predictive validity. At that point the landing page's "what we don't know yet" block can be rewritten into a real number — and until then it stays exactly as written.

## 15. Launch criteria and sequencing

### 15.1 Two tracks, starting together

Two tracks, starting together. With a model drafting content, review is **\~85 person-days — about nine weeks for two reviewers** (§11.4). The build, including the learning system (§19), is **about thirteen weeks for two engineers**. **The build is the critical path**, and content review fits inside it — provided reviewing starts in week 1, not when the app is ready.

The plan below assumes two quant-background reviewers working on model drafts, and a build team of two. Rows in bold are the learning system.

| Week | Build — 2 engineers | Content — model drafts, 2 reviewers |
| --- | --- | --- |
| 0 | — | Recruit two reviewers. Set up the drafting model with the AUTHORING.md prompts and `validate.py` |
| 1–2 | Schema, auth, item rendering, server-authoritative timing | Skill graph, prerequisites, weights; misconception library |
| 2–4 | Session runner, numeric and MCQ grading, θ and retention | Hub-skill learning paths first; first 140 templates |
| 3–5 | Admin template editor and seed sweep | Templates 140–320 |
| 4–6 | Python grader; symbolic and multi-step runners | Symbolic and multi-step templates, once the grader can verify them |
| 5–7 | Home, placement, settings | Learning paths 10–25; templates 320–460 |
| 6–8 | Drill runner; assessment mode | Templates 460–640 |
| 7–9 | **Lesson player, KaTeX pipeline, four widgets** | Learning paths 26–40 |
| 8–10 | **Lesson admin and health; remediation and refreshers; lesson flags** | Full review pass over templates |
| 9–11 | **Progress map and history, snapshot job, review sheet**; emails including the daily plan; legal pages; landing | **Full review pass over learning paths, in the real player on staging** |
| 11–12 | Instrumentation: calibration, lesson lift and funnel dashboards | Fixes from staging review |
| 12–13 | Private soak, beginner test, defect fixes | Backlog for the ongoing weekly rate |

Three dependencies drive the order. The admin tool lands in week 3 because bulk authoring without the seed sweep produces bulk defects. The grader lands in week 4 because symbolic and multi-step templates cannot be verified until something can evaluate them. And the lesson player lands before the final lesson review, because a learning path that validates as YAML can still teach badly — reviewers must see it the way a learner will.

The admin tool lands in week 3 because bulk authoring without the seed sweep produces bulk defects.

### 15.2 Ready to launch when

1. 640 templates at `live` across all five types, none with negative discrimination on internal testing
2. **40 learning paths live**, each passing `validate.py` and reviewed in the real player on staging — not only as YAML
3. Every template instance and every lesson step renders through KaTeX with no error sentinel
4. **A beginner test:** someone who does not know the material goes from onboarding → *start with lessons* → first lesson → first practice session without help and without confusion
5. A staff member has taken placement, ten sessions and one assessment end-to-end without a content defect reaching them — including at least one of each item type
6. Server-authoritative timing verified against a hostile client: answer submitted late, replayed, and double-submitted
7. **Grader failover verified** — with the Python service stopped, a symbolic item is voided and returned to the queue, and θ is untouched
8. **Learning never moves a score:** the tech spec §19.9 property test passes, and a manual check confirms a complete lesson, hints and all, leaves θ and levels above Familiar unchanged
9. Both flag paths verified end to end: item flag → retire → responses voided and θ replayed; lesson flag → new version → in-progress learners moved to the corrected step
10. Export and delete-account both work, tested against a real account
11. Privacy, terms, content-and-sources and *How scoring works* pages live
12. Brier score, lesson lift and readiness snapshots all recording, with dashboards that render

### 15.3 Explicitly not blocking launch

The two stub domains (Statistics & inference, Derivatives & pricing); the knowledge-map visual; mobile app UI; payments; teams; anything social. Band 5 content ships at launch but is the first thing to drop if the content track runs late — almost nobody reaches it inside 90 days, and it can be added while live without disturbing anything.

## 16. Editing live content

§12.4 covers retiring a flagged item. It does not cover the more common case: an author fixes something on a template that users have already answered. Without a rule here, a typo correction and an answer-key correction are the same operation, and the second one silently corrupts every score derived from it.

### 16.1 Templates are immutable once live

A template at `live` is never edited in place. Changes create a **new version** with the same `template_id` and an incremented `version`, and responses reference `(template_id, version, seed)`.

### 16.2 Three classes of change

| Class | Examples | Effect on history |
| --- | --- | --- |
| **Cosmetic** | typo, punctuation, clearer wording that cannot change the answer | New version. **History preserved.** Old responses stay valid and keep counting |
| **Substantive** | parameter ranges, time limit, band, distractor set, solution steps | New version. History preserved but **`b` resets to the band prior** — the difficulty estimate belonged to the old wording |
| **Corrective** | the answer, the tolerance, or a constraint that made some seeds unanswerable | New version. **All prior responses voided**, exactly as a retirement (§12.4): θ recomputed without them, users notified if a level changed |

The author picks the class in the admin tool and it is stored on the version. The tool defaults to **Substantive** — the safe middle — and requires a typed confirmation for Corrective, because that path rewrites people's scores.

### 16.3 Recomputing θ

Voiding responses means θ must be rebuilt, not patched. This is why §3.5 requires the response log to be append-only and to store `θ before` and `θ after`: the skill's history can be replayed from the first response with the voided ones skipped, deterministically, producing the θ the user would have had.

Replay is per (user, skill) and cheap. It is also the only operation in the product that can *lower* a user's level without them getting anything wrong, so it sends a short, plain explanation — "a question you answered turned out to be faulty; we've removed it and your Martingales level moved back to Working" — rather than changing the number quietly.

### 16.4 Lessons

Lessons are versioned but nothing downstream depends on them, so edits are free and need no classification.

## 17. Layout and breakpoints

Every app screen in the Figma file is drawn at 1280. That is the design width, not the only width, and the behaviour between sizes needs stating or it will be invented three different ways.

### 17.1 Breakpoints

| Width | Behaviour |
| --- | --- |
| < 1024 | **App is not supported.** Show the desktop-required interstitial with the same message as the mobile landing page. Do not degrade — a cramped timed runner produces bad data |
| 1024–1279 | Single-column content, right rails on Home and the skill page drop **below** the main column rather than beside it |
| 1280–1599 | The reference layout, exactly as drawn |
| ≥ 1600 | Content caps at **1440** and centres. Nothing stretches to fill an ultrawide |

### 17.2 What stretches and what does not

- **Home:** the skills card flexes; the right rail is fixed at 336.
- **Skill page:** the lesson column flexes and caps its text measure at **72 characters**; the state rail is fixed at 356.
- **Session runner:** the stage is centred and capped — 780 for a question stem, 320 for a numeric input, 820 for the multi-step column. It never widens with the window. A question that reflows as the window changes is a question that reads differently to two users, which the measurement cannot tolerate.
- **Progress:** four domain lanes at 1280 and above; two rows of two lanes from 1024 to 1279.
- **Landing page:** sections cap at 1120 and centre; fully fluid down to 360.

### 17.3 Zoom and text scaling

The app must survive 200% browser zoom at 1280 (which presents as 640 CSS pixels) by falling to the desktop-required interstitial rather than breaking. Respect `prefers-reduced-motion` on the timer bar and any progress animation.

### 17.4 Interaction states

Hover, focus, active, disabled, loading and error styling for every interactive element is specified in the Figma file, frame **17 · Interaction states**, not in this document. Focus rings are non-negotiable on the session runner: it is a keyboard-first surface.

## 18. Day-one launch configuration

Decisions that exist only because this is a public launch rather than a closed beta. Each resolves a contradiction found when the three documents were read against each other.

### 18.1 Archetypes at launch

Readiness is a weighted minimum, so an archetype whose required domains include one with no content produces a score pinned near zero — the user's weakest link would be something the product cannot teach them.

| Archetype | Launch state | Weights |
| --- | --- | --- |
| Puzzle / Trading | **Live** | Probability 40, Trading games 25, Stochastic 20, Mental math 15 |
| Speed / Market-making | **Live, reweighted** | Mental math 33, Trading games 33, Probability 34. Derivatives returns when that track ships |
| Research | **Visible, not selectable** | Shown as *coming with the Statistics track* |

Showing Research disabled rather than hiding it is deliberate: it tells a research-track candidate the product knows they exist, which is worth more than silence.

### 18.2 Placement and levels

Placement responses update θ (§7) but are **excluded from level evaluation and from the Level 3 cold streak**. Without this rule a correct placement answer satisfies Familiar (§5.1), contradicting §7.3.

### 18.3 Authentication

**Magic link and Google. No passwords.** This removes the password field, the change-password setting, the forgot-password flow, password-strength rules, breach checking, and an entire category of support request. The cost is one extra screen — *check your email* — and dependence on email deliverability, which the product already depends on for review reminders.

Links expire after 15 minutes and are single-use.

### 18.4 Consent defaults

| Setting | Default | Basis |
| --- | --- | --- |
| Review-due reminder | **On** | Service message the user has asked for by using the product; one-click unsubscribe in every email |
| Weekly summary | Off | Optional |
| **Share interview outcomes** | **Off** | Consent — cannot be pre-ticked under UK GDPR. Asked in context: when an interview date is set, and in the post-interview prompt |
| Desktop-handoff email | One send, then the address is deleted | Stated at the point of capture |

Auth cookies are strictly necessary and analytics is server-side and cookieless (tech spec §11), so **no cookie banner is required**. Worth keeping that way: adding a client-side analytics script later would bring the banner back.

### 18.5 Minimum age and support

- **Minimum age 16**, stated in the terms and asserted at sign-up. Pre-university applicants are a plausible part of the audience, and 16 is the UK threshold for consenting to data processing without a parent.
- **One monitored support address**, linked from the footer, Settings and every email. Someone reads it daily. A free product with no human on the other end loses trust faster than it loses users.

### 18.6 Screens added for launch

The UI spec gained five frames in this pass: **placement result** (the first readiness number — the activation moment), **assessment result** (the validated score — the north-star moment), **outcome prompt** (the calibration pipeline), **check your email**, and **desktop required**.

## 19. The learning system

The product's promise is three clauses: **arrive not knowing, learn it here, measure what you've learned.** Sections 3–10 are the measuring. This section is the teaching, and it carries equal weight.

### 19.1 Three modes

|  | Learn | Practice | Assessment |
| --- | --- | --- | --- |
| Purpose | acquire it | prove it cold | validate it |
| Hints and retries | **yes** | no | no |
| Time limit | none | per item | whole test |
| Affects θ, levels, score | **never** | yes | yes, plus recalibration |
| Solutions | on request, any time | after answering | after the whole test |

Learning can be supportive *because* it is never measured. Measurement stays honest *because* it is never scaffolded. The mode chip in the top bar always says which one you are in.

### 19.2 The learning path

Every skill has one learning path: **6–12 steps, 15–25 minutes, one idea per step.** Seven step types:

| Step | What it does | Why |
| --- | --- | --- |
| **Concept** | One idea, ≤ 150 words, concrete before abstract | Segmenting; concreteness fading |
| **Interactive** | A simulation the learner drives (§19.8) | See the result emerge before it is proved |
| **Worked example** | A full solution revealed step by step, with *"why does this step follow?"* prompts on 1–2 key steps | Worked-example effect; self-explanation |
| **Faded example** | The same structure with 1–2 steps left for the learner | The bridge from reading to doing |
| **Check** | A short question with hints and retries (§19.3) | Retrieval practice, immediately |
| **Trap** | A plausible wrong solution; find the broken step | Refutation — names the misconception before it bites |
| **Summary** | The key results, in one place | Consolidation; the review sheet before an interview |

**Default order**, which authors may adapt: hook → concept (+ interactive) → worked example → check → faded example → trap → transfer check → summary.

**Hard rules**, enforced by the content validator and again by the admin tool before promotion: never more than three steps in a row without a check; at least one worked and one faded example; exactly one trap, tied to the skill's most common misconception; at least three checks, the last marked as a transfer check in a different surface context from the worked example, so it tests the idea rather than pattern-matching the example.

### 19.3 Checks are learning, not measurement

Checks use the item template schema with `usage: lesson`. Unlimited attempts on the same instance, so hints stay meaningful. Up to two hints, offered after a wrong answer. The worked solution is available after a second wrong attempt, or on request.

Checks **never** update θ, *b*, levels, cold streaks, or any statistic used for measurement. They are recorded separately — first-try correctness, attempts, hints used, time — and feed only §19.4 and §19.10.

### 19.4 Earning "Familiar"

Complete the path: every step seen, every check eventually answered correctly. The **first-try check rate** then sets where practice begins: ≥ 70% starts at band 2, below that at band 1. A completed path can be revisited at any time in review mode.

Paths are **skippable**. A user who already knows the material goes straight to practice, and one correct scored answer earns Familiar anyway. Nobody is forced through a lesson they do not need.

### 19.5 Unlocking

**Learn** unlocks when every direct prerequisite is at least Familiar. **Practice** unlocks when every direct prerequisite is at least Working (§10.3, unchanged). Study can therefore run one level ahead of proof in the graph — enough to keep a beginner moving, not so far that they practise on sand.

### 19.6 Remediation — failure routes back to teaching

Every step declares the misconceptions it addresses (`addresses: [...]`). Two mechanisms use that:

- **Targeted review.** When a practice answer matches a named misconception, the answer screen links to the step tagged with it — *the two-minute part of the lesson on this mistake*. It opens in Learn mode and returns to the session.
- **Refresher.** Triggered by 3 wrong of the last 5 scored attempts on a skill, the same misconception twice within 10 attempts, or any demotion. The scheduler pauses new practice on that skill and inserts a \~5-minute refresher: the tagged concept step, one faded example, two fresh checks. Skippable; practice resumes after it either way.

This implements §4.2's promise that a failing skill is sent back to the lesson rather than served again and again.

### 19.7 Starting from scratch

Onboarding step 2 gains a third choice: **I'm new to this — start with lessons.** It skips placement (θ prior −0.5, §7.4), and Home's first action becomes the first lesson: the hub skill of the highest-weighted required domain — Counting & combinatorics for Puzzle/Trading. The daily plan stays lesson-led until 60% of required skills are Familiar.

### 19.8 Interactive widgets

Four at launch. Configured from lesson content, client-side only, never scored.

| Widget | Teaches |
| --- | --- |
| **Random-walk simulator** | Paths between barriers; empirical vs predicted hitting probabilities and durations |
| **Bayes frequency grid** | 1,000 people as dots — base rate, sensitivity and false positives made countable |
| **Sampling explorer** | A statistic of n draws — max, mean, order statistic — simulated, with its histogram against the formula |
| **Kelly growth simulator** | A bet-fraction slider over many paths of log-wealth; the peak at Kelly and ruin beyond it |

Four is a deliberate ceiling — each is a real engineering component. New widgets are v1.1.

### 19.9 Maths typesetting

All mathematics in lessons, stems, solutions and misconception text is written in LaTeX and rendered by KaTeX, server-side, to HTML. Emails get plain-text fallbacks. The monospace notation in the Figma mocks stands in for rendered maths.

### 19.10 Measuring the teaching

**Users** see learning and proof on one ladder: Familiar is *learned*, Working and Interview-ready are *proved*. Skill rows show both.

**The team** sees lesson health in the admin tool: completion rate, drop-off step, per-check first-try rate, time per step, and **lesson lift** — for users who completed the path, actual correctness divided by predicted correctness over their first five practice attempts. Lift at or below 1.0 after 50 completions means the lesson is not teaching; revise it. This is the lesson equivalent of item discrimination, and it is the honest test of whether the product teaches at all.

### 19.11 Flagging a lesson

Lessons get the same release valve as questions. Every step carries *Something wrong with this step?*, which files a flag against `(lesson, version, step)` into the same admin queue as item flags. Because learning is unmeasured, resolving a lesson flag never touches anyone's scores — it produces a new lesson version under the usual change classes (§16), and learners mid-path are moved to the corrected step. Model-drafted lessons will contain errors; this is how they get found.

### 19.12 The review sheet

Every completed learning path contributes its `key_results` to a personal **review sheet**: one page, grouped by domain in learning-path order, containing only skills the learner has actually learned. Skills not yet learned appear as a single muted line — *learn Reflection principle to add it here*. It exports to a print-ready PDF, because the realistic use is the night before an interview. It lives under Learn.

### 19.13 Keeping learners coming back

The daily email (§13.1) becomes **Today's plan**. It fires when *anything* is waiting — reviews due, or a lesson in the plan — not only when reviews are due. Without this, a beginner who completes one lesson and leaves never hears from the product again, because they have no reviews yet. The content adapts: reviews only, lesson only, or both, with a single *Start today's plan* button and the estimated minutes.

### 19.14 Progress

A **Progress** screen answers *what have I learned, what have I proved, and how far have I come?* It **replaces the Skills catalogue**: one fewer place for skills to live, and the catalogue's job — seeing every skill and its status — is exactly what the map below does better. Two tabs:

**Skill map.** All 40 skills in four domain lanes, arranged in tiers by prerequisite depth *within the domain*, so each lane reads top to bottom as a curriculum. Each tile carries one of five statuses:

| Status | Meaning |
| --- | --- |
| Locked | a prerequisite is not yet learned |
| Ready to learn | unlocked, not started |
| Learned | Familiar — the learning path is complete |
| Working | proved under practice conditions |
| Interview-ready | proved cold, at interview difficulty |

A skill with retention below 0.85 is marked **fading** on its tile, with its `r`. Selecting a tile highlights its prerequisites and the skills it unlocks, and shows a one-line summary with a link to the skill. The two stub domains appear as greyed lanes marked *in progress*. This is the knowledge map that was cut from v1 in its expensive form — no graph layout, no edge routing, no pan and zoom — and it delivers most of what that version would have.

**Over time.** The readiness trend since the first real score, with the weakest domain's trend beneath it and a marker at every validated assessment; the count of skills in each status, week by week; and a session history of lessons, practice sessions, placement and assessments with their outcomes and readiness change. Because readiness is computed on read (tech spec §5), the trend requires a **daily snapshot** of each user's readiness and domain scores — a nightly job, a small table, and the only derived value the product stores for history's sake.

Navigation becomes **Home · Learn · Progress · Settings**.

### 19.15 What it costs

Content: a learning path is \~1.5 person-days rather than half a day, which raises the content plan to \~169 person-days — \~85 of review with a model drafting (§11.3–11.4). Build: the lesson player, four widgets, the KaTeX pipeline, refresher composition, lesson health, lesson flagging, the review sheet, Progress with its snapshot job, and the adaptive daily email — roughly **4.5 engineer-weeks**, which takes the build to about thirteen weeks for two engineers. With content model-drafted, **the build is now the critical path** (§15.1).

## 20. Assumptions and tunables

Everything in this list is a decision I made so the build is not blocked. Each is cheap to change *if it is stored as a constant rather than scattered through the code*. The build spec should collect them into a single configuration module.

| Constant | Value | Change costs |
| --- | --- | --- |
| Band priors `b₀` | −1.2 / −0.4 / +0.4 / +1.2 / +2.0 | Nothing — refit monthly from data (§14.3) |
| `Kᵤ` schedule | 0.60 / 0.35 / 0.20 | Nothing |
| `Kᵢ` schedule | 0.08 / 0.02 | Nothing |
| Prereq propagation | 0.15, one hop, correct only | Nothing |
| `S₀` | 6 days | Changes every review interval — re-check against the 0.85 threshold together |
| Review threshold | r < 0.85 | As above; the pair moves together |
| Stability multipliers | ×2.3 pass, ×1.6 slow pass, ×0.35 fail | Nothing |
| Readiness blend | 0.25 mean / 0.75 power mean p = −4 | Rescores every user — announce it if changed post-launch |
| Level-3 streak | 3 consecutive | Structural; changing it re-levels everyone |
| Provisional thresholds | 20 attempts, 5 per domain | Nothing |
| Target `p` for new items | 0.75 | Nothing |
| Session mix | 40 / 30 / remainder | Nothing |
| **Multi-step partial credit** | `y = correct / total` | Changes θ history; re-derivable from the response log |
| **Multi-step mastery rule** | all checkpoints unaided | Structural |
| **Drill Kᵤ scaling** | `min(1, N/10)` | Nothing |
| **Drill pass fraction** | 0.80 | Nothing |
| **Grader timeout** | 2 s per expression | Nothing |
| **Numeric probe points** | 20 | Nothing |
| Assessment unlock | 8 skills at Working, or 14 days + 100 attempts | **Watch this one** — it gates the north-star metric |
| Assessment pass | ≥ 65%, no domain < 40% | Rescores validation status |
| Validation window | 21 days | Nothing |

### The three I am least sure about

**The assessment unlock threshold.** Eight skills at Working is a guess, and it sits directly on the north-star metric. If week-one data shows most users stalling before it, lower it — the first validated score is the activation event and everything upstream exists to deliver it.

**Target p = 0.75.** The spacing literature favours 0.80–0.85 for retention efficiency. I chose lower because interview preparation needs users to meet the wall rather than be protected from it. If early retention is poor, this is the first dial to turn.

**Multi-step partial credit.** Giving θ credit for three of four checkpoints while withholding mastery credit is the right shape, but the weighting is a guess. If multi-step items turn out to inflate θ relative to observed assessment performance, the fix is to weight later checkpoints more heavily than early ones — the last step is usually the one that carries the insight, and the first is usually arithmetic.
