/**
 * Zod schemas for authored content (tech spec §5: "validated by a Zod schema per
 * type on write, so the looseness is at rest, not at the boundary").
 */
import { z } from "zod";

const band = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
const expr = z.string().min(1).max(2000);
const tolerance = z.object({ abs: z.number().optional(), rel: z.number().optional(), log: z.number().optional() }).strict();
const nearMiss = z.object({ expr, misconception_id: z.string() }).strict();
const param = z.discriminatedUnion("type", [
  z.object({ name: z.string(), type: z.literal("int"), min: z.number(), max: z.number(), step: z.number().optional() }).strict(),
  z.object({ name: z.string(), type: z.literal("float"), min: z.number(), max: z.number(), step: z.number() }).strict(),
  z.object({ name: z.string(), type: z.literal("choice"), values: z.array(z.number()).min(1), labels: z.array(z.string()).optional() }).strict(),
]);
const derived = z.object({ name: z.string(), expr }).strict();

const base = {
  id: z.string().regex(/^[a-z0-9.-]+$/),
  version: z.number().int().positive(),
  skill_id: z.string(),
  band,
  status: z.enum(["draft", "in_review", "live", "retired"]).default("in_review"),
  usage: z.enum(["practice", "lesson"]).default("practice"),
  placement: z.boolean().optional(),
  params: z.array(param).optional(),
  constraints: z.array(expr).optional(),
  derived: z.array(derived).optional(),
  stem: z.string().min(1),
  time_limit_sec: z.number().int().positive(),
  solution_steps: z.array(z.string()).optional(),
  answer_display: z.string().optional(),
  source: z.string().optional(),
};

export const templateSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("numeric"), answer: expr, tolerance: tolerance.optional(), unit: z.enum(["none", "percent", "currency"]).optional(), near_miss: z.array(nearMiss).optional() }).strict(),
  z
    .object({
      ...base,
      type: z.literal("mcq"),
      answer: expr.optional(),
      answer_label: z.string().optional(),
      distractors: z
        .array(z.union([z.object({ expr, misconception_id: z.string() }).strict(), z.object({ label: z.string(), misconception_id: z.string() }).strict()]))
        .length(3),
      display: z.object({ format: z.enum(["number", "percent", "fraction"]), decimals: z.number().int().optional() }).strict().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("symbolic"),
      answer_expr: expr,
      variables: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/)).min(1),
      domain_hints: z.array(z.object({ var: z.string(), assume: z.string() }).strict()).optional(),
      equivalence: z.enum(["algebraic", "numeric_probe"]).optional(),
      tests: z.object({ accept: z.array(z.string()).optional(), reject: z.array(z.string()).optional() }).strict().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("multistep"),
      checkpoints: z
        .array(
          z
            .object({
              prompt: z.string(),
              kind: z.enum(["numeric", "symbolic"]),
              answer: expr.optional(),
              answer_expr: expr.optional(),
              variables: z.array(z.string()).optional(),
              tolerance: tolerance.optional(),
              near_miss: z.array(nearMiss).optional(),
            })
            .strict(),
        )
        .min(2)
        .max(5),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("drill"),
      drill: z
        .object({
          count: z.number().int().min(2).max(100),
          total_sec: z.number().int().positive(),
          pass_fraction: z.number().min(0).max(1).optional(),
          item: z
            .object({
              params: z.array(param),
              constraints: z.array(expr).optional(),
              derived: z.array(derived).optional(),
              stem: z.string(),
              answer: expr,
              tolerance: tolerance.optional(),
              near_miss: z.array(nearMiss).optional(),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
]).superRefine((t, ctx) => {
  if (t.type !== "mcq") return;
  if ((t.answer === undefined) === (t.answer_label === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exactly one of answer / answer_label" });
  }
  if (!t.distractors.every((d) => ("label" in d) === (t.answer_label !== undefined))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "options must be all numeric or all text" });
  }
});

const check = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("numeric"),
    stem: z.string(),
    answer: expr,
    tolerance: z.object({ abs: z.number().optional(), rel: z.number().optional() }).optional(),
    feedback: z.array(z.object({ answer: z.union([z.string(), z.number()]), text: z.string() })).optional(),
    hints: z.array(z.string()).max(2).optional(),
    solution: z.string(),
  }),
  z.object({
    type: z.literal("mcq"),
    stem: z.string(),
    answer_label: z.string(),
    distractors: z.array(z.object({ label: z.string(), misconception_id: z.string().optional(), feedback: z.string().optional() })).min(1),
    hints: z.array(z.string()).max(2).optional(),
    solution: z.string(),
  }),
]);

const stepBase = { id: z.string(), title: z.string().optional(), minutes: z.number().optional(), addresses: z.array(z.string()).optional() };
export const lessonSchema = z.object({
  skill_id: z.string(),
  version: z.number().int().positive(),
  title: z.string(),
  est_minutes: z.number(),
  status: z.enum(["draft", "in_review", "live"]).default("in_review"),
  key_results: z.array(z.string()),
  steps: z.array(
    z.discriminatedUnion("type", [
      z.object({ ...stepBase, type: z.literal("concept"), body: z.string() }),
      z.object({ ...stepBase, type: z.literal("interactive"), body: z.string(), widget: z.enum(["random_walk", "bayes_grid", "sampling_explorer", "kelly_growth"]), config: z.record(z.unknown()), note: z.string().optional() }),
      z.object({
        ...stepBase,
        type: z.literal("worked"),
        problem: z.string(),
        steps: z.array(
          z.object({
            text: z.string(),
            self_explain: z.object({ prompt: z.string(), options: z.array(z.object({ text: z.string(), correct: z.boolean(), feedback: z.string() })) }).optional(),
          }),
        ),
      }),
      z.object({
        ...stepBase,
        type: z.literal("faded"),
        problem: z.string(),
        steps: z.array(z.union([z.object({ text: z.string() }), z.object({ blank: z.object({ prompt: z.string(), answer: expr, hints: z.array(z.string()).optional(), solution: z.string().optional() }) })])),
      }),
      z.object({ ...stepBase, type: z.literal("check"), transfer: z.boolean().optional(), check }),
      z.object({ ...stepBase, type: z.literal("trap"), prompt: z.string(), flawed_solution: z.array(z.string()), error_step: z.number().int(), explanation: z.string() }),
      z.object({ ...stepBase, type: z.literal("summary"), body: z.string() }),
    ]),
  ),
});

export const bundleSchema = z.object({
  version: z.number(),
  domains: z.array(z.object({ id: z.string(), name: z.string(), short: z.string(), order: z.number(), live: z.boolean(), hub: z.string().optional() })),
  skills: z.array(z.object({ id: z.string(), domain: z.string(), name: z.string(), band: band, importance: z.union([z.literal(1), z.literal(2), z.literal(3)]), minutes: z.number(), prereqs: z.array(z.string()) })),
  archetypes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      firms: z.string().optional(),
      selectable: z.boolean(),
      note: z.string().optional(),
      weights: z.record(z.number()),
      required: z.array(z.string()),
      band_overrides: z.record(z.number()).optional(),
    }),
  ),
  misconceptions: z.array(z.object({ id: z.string(), skill: z.string(), label: z.string(), explanation: z.string() })),
  templates: z.array(z.unknown()),
  lessons: z.array(z.unknown()),
  readings: z.record(z.object({ kind: z.string(), body: z.string() })),
});
