# Authoring guide

How a template gets from a blank file to a live question, and how a learning path gets written. Read with product spec §8, §11, §12 and §16.

## The pipeline

```
draft (LLM) → validate.py → human review → staging preview → promote to live
```

Nothing reaches a user at `draft`. The validator is a gate you run yourself before asking for review; it is not a substitute for review.

## 1. Draft

One template per file, named `{skill_id}.b{band}.{slug}.yaml`. Start from the exemplar of the same type in `templates/` — they are deliberately annotated.

**Drafting prompt.** Paste into the model with the three placeholders filled:

```text
You are drafting an interview-preparation item for Quant Academy.

Skill: {skill.name} ({skill.id})
Band: {band} — 1 recall · 2 textbook · 3 interview-typical · 4 hard multi-step · 5 competition
Item type: {type}
Known misconceptions for this skill:
{misconceptions for this skill, id + explanation}

Write ONE item template in YAML matching the attached exemplar exactly.

Requirements:
- The stem must read like a question a trading-firm interviewer would ask aloud.
- Parameterise every number that can vary without changing the reasoning.
  Aim for at least 20 distinct answers across the parameter space.
- The answer must be a closed-form expression over the parameters using only:
  + - * / ^ ( ) floor ceil abs min max sqrt log exp factorial choose mod pi e
  (no sum, no conditionals — derive a closed form instead)
- Every distractor or near-miss must be the result of a SPECIFIC named error
  from the list above. Do not invent plausible-looking wrong numbers.
- Solution steps must still be correct after parameter substitution.
- Original work only. Do not reproduce any question you have seen attributed
  to a named firm, interview report, or published collection.

Exemplar:
{paste the exemplar file for this type}
```

## 2. Validate

```bash
python tools/validate.py templates/your-file.yaml --preview 5
```

Read the five rendered instances, not just the PASS line. The validator catches mechanical defects; only a person catches a question that is technically valid and pedagogically useless.

## 3. Review checklist

The reviewer signs off on every line before promoting.

- [ ] Solved independently by hand for at least two rendered instances — **without looking at the answer expression first**
- [ ] Stem is unambiguous: one reasonable reading, units stated, rounding stated if it matters
- [ ] Band is honest: would a strong candidate find this interview-typical (3), or genuinely hard (4)?
- [ ] Every distractor is a mistake a real candidate makes, and its misconception explanation is correct
- [ ] Time limit is achievable by a prepared candidate with margin — not a speed trap unless the skill is speed
- [ ] Solution steps teach, not just verify
- [ ] Original: not recognisably derived from a named firm's question
- [ ] `validate.py` passes with no FAILs; any WARNs have a written reason

## 4. Promote

Promotion happens in the admin tool, which re-runs the sweep with the production PRNG (tech spec §7) and requires a change class for anything already live (product spec §16).

## Learning paths

Every skill has one learning path: 6–12 steps, 15–25 minutes, one idea per step (product spec §19). The exemplar is `lessons/stoch.gamblers-ruin.yaml` — copy its structure.

### Step types

| Type | Required fields | Notes |
|---|---|---|
| `concept` | `body` | ≤ 150 words. Concrete before abstract |
| `interactive` | `body`, `widget`, `config` | Widget ∈ `random_walk`, `bayes_grid`, `sampling_explorer`, `kelly_growth`. Always pass a `seed` |
| `worked` | `problem`, `steps[]` | Put a `self_explain` prompt on the 1–2 steps that carry the insight. Exactly one correct option; every option gets feedback |
| `faded` | `problem`, `steps[]` with 1–2 `blank` | A blank is `{prompt, answer, hints?}`. Blank the step that requires thinking, not the arithmetic at the end |
| `check` | `check: {type, stem, answer, hints, solution}` | Same grammar as templates. ≤ 2 hints. `params` optional — checks are unmeasured, so a fixed instance is fine |
| `trap` | `prompt`, `flawed_solution[]`, `error_step`, `explanation`, `addresses` | The flaw must be the skill's most common real mistake, not a typo |
| `summary` | `body` | Final step. The lesson's `key_results` appear here and in the learner's review sheet |

Any step may carry `addresses: [misconception ids]`. **Tag generously** — targeted review and refreshers (§19.6) can only route a learner to steps that are tagged.

### Rules the validator enforces

- 6–12 steps; unique, stable step `id`s — learner progress is keyed on them, so never renumber
- At least one `worked`, at least one `faded`, exactly one `trap`
- At least three `check`s; the last has `transfer: true` and a different surface context from the worked example
- No more than three steps in a row without a check
- Every answer expression evaluates; every misconception reference exists
- Maths in LaTeX (`$...$`); KaTeX renders it. Escape backslashes in YAML double-quoted strings

### Drafting prompt for a learning path

```text
You are writing a learning path for Quant Academy. The learner does NOT know
this material yet. Your job is to teach it well enough that they can then
answer interview questions on it cold.

Skill: {skill.name} ({skill.id})
Prerequisites the learner has already learned: {prereq names}
Misconceptions for this skill:
{misconceptions for this skill, id + explanation}

Write ONE learning path in YAML matching the attached exemplar exactly.

Requirements:
- 6–12 steps, 15–25 minutes. One idea per step.
- Follow roughly: hook → concept (+ interactive if a listed widget fits)
  → worked example → check → faded example → trap → check → transfer check → summary.
- Concept steps ≤ 150 words. Start concrete (a specific game, number, or
  situation) and only then generalise.
- The worked example must show the METHOD, not just the result. Add a
  self-explanation prompt on the step that carries the key insight.
- The faded example blanks a reasoning step, not final arithmetic.
- The trap is the single most common real mistake from the list above,
  written as a plausible solution with one broken step.
- The final check tests the same idea in different clothes (a different
  setting, same structure) and is marked transfer: true.
- Tag every step that addresses a misconception with addresses: [...].
- All maths in LaTeX. Original work only.

Exemplar:
{paste lessons/stoch.gamblers-ruin.yaml}
```

Run `python tools/validate.py` after drafting. As with templates, read the rendered path yourself — the validator checks structure, not whether it teaches. The live measure of that is **lesson lift** (product spec §19.10), and any path whose lift stays at or below 1.0 after 50 completions gets rewritten.

## Schema amendments found while building the exemplars

Building one real template per type surfaced six gaps between the specs and practice. **These should be folded into the build spec before `packages/items` is written.**

| # | Gap | Fix |
|---|---|---|
| 1 | MCQ distractors are defined only as `expr`, so conceptual multiple choice — the adverse-selection question in the UI spec — cannot be expressed | Allow `label: string` as an alternative to `expr` on MCQ options. Collision checks compare labels |
| 2 | The seen-seed rule keys on `(template, seed)`. A template with no parameters, or a small parameter space, produces the **same instance from different seeds**, so a user can see an identical question twice while the system believes it is unseen | Key dedupe on an **instance fingerprint** — a hash of the sampled parameter values — not on the seed. Store it on `responses` and index it |
| 3 | "≥ 20 distinct answers" is meaningless for symbolic items, whose answer is an expression | The distinct-answer rule applies to numeric, MCQ, multi-step and drill only |
| 4 | The expression whitelist had no `mod`, so excluding multiples of 10 needed `x - 10*floor(x/10)`. E[max] of dice needs a closed form for a sum of powers | **Applied:** `mod` added to the grammar in tech spec §7 and in `validate.py`. `sum` stays out deliberately — it forces authors to find the closed form |
| 5 | MCQ collisions must be checked **at display precision**. Two options that differ in the fourth decimal place render identically at "93%" | Collision check runs on rendered strings, as `validate.py` does |
| 6 | Drills have no top-level instruction text | `stem` is required on every type; for drills it is the instruction line above the set |

## Tracking throughput

The content plan (product spec §11.3) assumes 10 numeric, 8 MCQ, 8 symbolic, 4 multi-step or 3 drill templates per author-day, **reviewed**. Track actuals from week one. If multi-step comes in below 3/day, sequence it later and front-load the cheaper types — the readiness score works with any mix, and a thinner multi-step library at launch is better than a later launch.
