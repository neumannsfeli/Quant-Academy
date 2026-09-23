/**
 * Load the content pack (dist/content.json from the curriculum repo) into Postgres.
 *
 * Every template is Zod-validated and re-swept with the production PRNG
 * (tech spec §7, product spec §12.2) before it is stored. A version already
 * stored with different content is refused if it is live: live templates are
 * immutable, and changes must arrive as a new version (product spec §16.1).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { BAND_PRIORS, type Band } from "@qa/scoring";
import { sweepTemplate, type ItemTemplate } from "@qa/items";
import { validateLesson, type Lesson } from "@qa/learning";
import { closeDb, getDb } from "./client";
import { bundleSchema, lessonSchema, templateSchema } from "./content-schema";
import * as s from "./schema";

/** Sweep failures that block serving outright. FEW_DISTINCT blocks promotion only. */
const SERVE_BLOCKING = new Set(["BUILD", "NON_FINITE", "MCQ_COLLISION", "STEM_RENDER", "NEAR_MISS_EQUALS_ANSWER", "RESERVED_NAME", "MAGNITUDE_SPAN"]);

export function defaultBundlePath(): string {
  return process.env.CONTENT_BUNDLE ?? resolve(process.cwd(), "../../../Quant-Academy-Curriculum-/dist/content.json");
}

/** Tech spec §19.11: tier = longest chain of same-domain prerequisites. */
export function computeTiers(skills: { id: string; domain: string; prereqs: string[] }[]): Map<string, number> {
  const byId = new Map(skills.map((k) => [k.id, k]));
  const memo = new Map<string, number>();
  const tier = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    const k = byId.get(id)!;
    const same = k.prereqs.filter((p) => byId.get(p)?.domain === k.domain);
    const t = same.length ? 1 + Math.max(...same.map(tier)) : 0;
    memo.set(id, t);
    return t;
  };
  for (const k of skills) tier(k.id);
  return memo;
}

export async function seedContent(bundlePath = defaultBundlePath(), log = console.log) {
  const raw = JSON.parse(readFileSync(bundlePath, "utf8"));
  const bundle = bundleSchema.parse(raw);
  const db = getDb();
  const tiers = computeTiers(bundle.skills);
  const misconceptionIds = new Set(bundle.misconceptions.map((m) => m.id));

  const templates = bundle.templates.map((t, i) => {
    const parsed = templateSchema.safeParse(t);
    if (!parsed.success) {
      throw new Error(`template #${i} (${(t as { id?: string }).id}): ${parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
    }
    return parsed.data as unknown as ItemTemplate & { status: string; usage: string; placement?: boolean };
  });
  const lessons = bundle.lessons.map((l) => lessonSchema.parse(l) as unknown as Lesson & { status: string });

  await db.transaction(async (tx) => {
    for (const d of bundle.domains) {
      const row = { id: d.id, name: d.name, short: d.short, position: d.order, live: d.live, hubSkillId: d.hub ?? null };
      await tx.insert(s.domains).values(row).onConflictDoUpdate({ target: s.domains.id, set: row });
    }
    for (const k of bundle.skills) {
      const row = { id: k.id, domainId: k.domain, name: k.name, band: k.band, importance: k.importance, lessonMinutes: k.minutes, tier: tiers.get(k.id) ?? 0 };
      await tx.insert(s.skills).values(row).onConflictDoUpdate({ target: s.skills.id, set: row });
    }
    await tx.delete(s.skillPrereqs);
    const edges = bundle.skills.flatMap((k) => k.prereqs.map((p) => ({ skillId: k.id, prereqId: p })));
    if (edges.length) await tx.insert(s.skillPrereqs).values(edges);
    for (const m of bundle.misconceptions) {
      const row = { id: m.id, skillId: m.skill, label: m.label, explanation: m.explanation };
      await tx.insert(s.misconceptions).values(row).onConflictDoUpdate({ target: s.misconceptions.id, set: row });
    }
    for (const a of bundle.archetypes) {
      const requiredSkills = Object.fromEntries(a.required.map((id) => [id, (a.band_overrides?.[id] ?? 3) as Band]));
      const row = { id: a.id, name: a.name, firms: a.firms ?? null, selectable: a.selectable, note: a.note ?? null, weights: a.weights, requiredSkills };
      await tx.insert(s.archetypes).values(row).onConflictDoUpdate({ target: s.archetypes.id, set: row });
    }

    let blocked = 0;
    let promotable = 0;
    for (const t of templates) {
      const sweep = sweepTemplate(t, 200, 0);
      const serveable = !sweep.issues.some((i) => i.severity === "fail" && SERVE_BLOCKING.has(i.code));
      if (!serveable) blocked++;
      if (sweep.passed) promotable++;
      const [existing] = await tx
        .select()
        .from(s.itemTemplates)
        .where(and(eq(s.itemTemplates.id, t.id), eq(s.itemTemplates.version, t.version)));
      if (existing && existing.status === "live" && JSON.stringify(existing.payload) !== JSON.stringify(t)) {
        throw new Error(`${t.id} v${t.version} is live and its content changed: publish it as version ${t.version + 1}`);
      }
      const row = {
        id: t.id,
        version: t.version,
        skillId: t.skill_id,
        band: t.band,
        type: t.type,
        status: existing?.status === "live" || existing?.status === "retired" ? existing.status : t.status,
        usage: t.usage,
        placement: !!t.placement,
        timeLimitSec: t.time_limit_sec,
        payload: t,
        sweep: { passed: sweep.passed, serveable, issues: sweep.issues, distinctAnswers: sweep.distinctAnswers },
      };
      await tx.insert(s.itemTemplates).values(row).onConflictDoUpdate({
        target: [s.itemTemplates.id, s.itemTemplates.version],
        set: { ...row, status: sql`case when ${s.itemTemplates.status} in ('live','retired') then ${s.itemTemplates.status} else excluded.status end` },
      });
      await tx
        .insert(s.itemStats)
        .values({ templateId: t.id, version: t.version, b: BAND_PRIORS[t.band] })
        .onConflictDoNothing();
    }

    for (const l of lessons) {
      const issues = validateLesson(l, misconceptionIds).filter((i) => i.severity === "fail");
      if (issues.length) throw new Error(`lesson ${l.skill_id}: ${issues.map((i) => i.message).join("; ")}`);
      const row = { skillId: l.skill_id, version: l.version, title: l.title, estMinutes: l.est_minutes, steps: l.steps, keyResults: l.key_results, status: l.status };
      await tx.insert(s.lessons).values(row).onConflictDoUpdate({ target: [s.lessons.skillId, s.lessons.version], set: row });
    }
    for (const [skillId, r] of Object.entries(bundle.readings)) {
      const row = { skillId, kind: r.kind, body: r.body };
      await tx.insert(s.readings).values(row).onConflictDoUpdate({ target: s.readings.skillId, set: row });
    }
    log(
      `seeded ${bundle.domains.length} domains, ${bundle.skills.length} skills, ${edges.length} edges, ` +
        `${bundle.misconceptions.length} misconceptions, ${templates.length} templates ` +
        `(${promotable} pass the sweep, ${templates.length - blocked} serveable), ${lessons.length} lessons, ` +
        `${Object.keys(bundle.readings).length} readings`,
    );
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seedContent(process.argv[2] ?? defaultBundlePath());
  await closeDb();
}
