/**
 * The admin and authoring tool (product spec §12, §16; tech spec §8 admin, §19.7).
 * Mounted under /api/admin with its own role check.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb, schema as s } from "@qa/db";
import { buildInstance, sweepTemplate, type ItemTemplate } from "@qa/items";
import { lessonLift } from "@qa/learning";
import {
  BAND_PRIORS,
  applyLessonCompletion,
  applyToUser,
  initialSkillState,
  observedTheta,
  recalibrate,
  seedInferred,
  type Band,
  type Level,
  type Outcome,
  type SkillState,
} from "@qa/scoring";
import { templateSchema } from "@qa/db/content-schema";
import { archetypeFor, getContent, invalidateContent } from "./content";
import { AppError } from "./errors";
import { events } from "./events";
import { getGrader } from "./grader";
import { clientPayload, solutionHtml, answerHtml } from "./instances";
import { interviewDateOf, loadStates, saveState } from "./states";
import { renderTex } from "./tex";

export type Role = "learner" | "author" | "reviewer" | "admin";

export function requireRole(role: string, allowed: Role[]) {
  if (!allowed.includes(role as Role)) throw new AppError("FORBIDDEN");
}

const SERVE_BLOCKING = new Set(["BUILD", "NON_FINITE", "MCQ_COLLISION", "STEM_RENDER", "NEAR_MISS_EQUALS_ANSWER", "RESERVED_NAME", "MAGNITUDE_SPAN"]);

// ── Templates ──────────────────────────────────────────────────────────────

export async function listTemplates(filter: { skillId?: string; status?: string } = {}) {
  const db = getDb();
  const rows = await db.select().from(s.itemTemplates).orderBy(asc(s.itemTemplates.skillId), asc(s.itemTemplates.id), desc(s.itemTemplates.version));
  const stats = await db.select().from(s.itemStats);
  const statBy = new Map(stats.map((x) => [`${x.templateId}@${x.version}`, x]));
  const seen = new Set<string>();
  return rows
    .filter((r) => (!filter.skillId || r.skillId === filter.skillId) && (!filter.status || r.status === filter.status))
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => {
      const st = statBy.get(`${r.id}@${r.version}`);
      return {
        id: r.id,
        version: r.version,
        skillId: r.skillId,
        band: r.band,
        type: r.type,
        status: r.status,
        usage: r.usage,
        sweepPassed: !!r.sweep?.passed,
        issues: r.sweep?.issues ?? [],
        responses: st?.responses ?? 0,
        pValue: st && st.responses ? st.correct / st.responses : null,
        flags: st?.flagCount ?? 0,
      };
    });
}

export async function getTemplate(id: string) {
  const db = getDb();
  const versions = await db.select().from(s.itemTemplates).where(eq(s.itemTemplates.id, id)).orderBy(desc(s.itemTemplates.version));
  if (!versions.length) throw new AppError("NOT_FOUND", "template");
  const latest = versions[0]!;
  return {
    id,
    versions: versions.map((v) => ({ version: v.version, status: v.status, changeClass: v.changeClass, createdAt: v.createdAt.toISOString(), reviewNote: v.reviewNote })),
    latest: { version: latest.version, status: latest.status, payload: latest.payload, sweep: latest.sweep },
    previews: previewSeeds(latest.payload as ItemTemplate, [1, 2, 3, 4, 5]),
  };
}

/** §12.1 — five random seeds side by side, so the author sees the parameter space. */
export function previewSeeds(t: ItemTemplate, seeds: number[]) {
  return seeds.map((seed) => {
    try {
      const inst = buildInstance(t, seed);
      const client = clientPayload(inst);
      return {
        seed,
        ok: true as const,
        params: inst.params,
        stemHtml: client.stemHtml,
        options: inst.mcq?.options.map((o) => ({ html: renderTex(o.label), correct: o.correct, misconceptionId: o.misconceptionId })) ?? null,
        answerHtml: answerHtml(inst),
        nearMiss: inst.numeric?.nearMiss ?? [],
        solutionHtml: solutionHtml(inst),
      };
    } catch (e) {
      return { seed, ok: false as const, error: (e as Error).message };
    }
  });
}

function validatePayload(payload: unknown): ItemTemplate {
  const parsed = templateSchema.safeParse(payload);
  if (!parsed.success) {
    const i = parsed.error.issues[0]!;
    throw new AppError("VALIDATION", `${i.path.join(".")}: ${i.message}`, i.path.join("."));
  }
  return parsed.data as unknown as ItemTemplate;
}

/** POST/PATCH — a change is always a new version; nothing live is mutated (§16.1). */
export async function saveTemplate(authorId: string, payload: unknown) {
  const db = getDb();
  const t = validatePayload(payload);
  const content = await getContent();
  if (!content.skills.has(t.skill_id)) throw new AppError("VALIDATION", "unknown skill", "skill_id");
  const [prev] = await db.select().from(s.itemTemplates).where(eq(s.itemTemplates.id, t.id)).orderBy(desc(s.itemTemplates.version)).limit(1);
  const version = prev ? prev.version + 1 : 1;
  const tv = { ...t, version, status: "draft" } as ItemTemplate & { status: string };
  const sweep = sweepTemplate(tv, 200, 0);
  await db.insert(s.itemTemplates).values({
    id: t.id,
    version,
    skillId: t.skill_id,
    band: t.band,
    type: t.type,
    status: "draft",
    usage: (t as { usage?: string }).usage ?? "practice",
    placement: !!(t as { placement?: boolean }).placement,
    timeLimitSec: t.time_limit_sec,
    payload: tv,
    authorId,
    sweep: { passed: sweep.passed, serveable: !sweep.issues.some((i) => i.severity === "fail" && SERVE_BLOCKING.has(i.code)), issues: sweep.issues, distinctAnswers: sweep.distinctAnswers },
  });
  await db.insert(s.itemStats).values({ templateId: t.id, version, b: BAND_PRIORS[t.band] }).onConflictDoNothing();
  invalidateContent();
  return getTemplate(t.id);
}

/** §12.2 — the 200-seed sweep, plus the symbolic accept/reject tests against the real grader. */
export async function runSweep(id: string, version?: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(s.itemTemplates)
    .where(version ? and(eq(s.itemTemplates.id, id), eq(s.itemTemplates.version, version)) : eq(s.itemTemplates.id, id))
    .orderBy(desc(s.itemTemplates.version))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "template");
  const t = row.payload as ItemTemplate;
  const sweep = sweepTemplate(t, 200, 0);
  const issues = [...sweep.issues];
  if (t.type === "symbolic" && t.tests) {
    const inst = buildInstance(t, 1);
    for (const [list, expect] of [[t.tests.accept ?? [], true], [t.tests.reject ?? [], false]] as const) {
      for (const expr of list) {
        const r = await getGrader().grade({ submitted: expr, answer: inst.symbolic!.answerExpr, variables: t.variables, assumptions: inst.symbolic!.assumptions });
        if (r.status !== "graded") issues.push({ severity: "fail", code: "GRADER", message: `grader ${r.status} on "${expr}"` });
        else if (r.correct !== expect) issues.push({ severity: "fail", code: expect ? "ACCEPT_REJECTED" : "REJECT_ACCEPTED", message: `"${expr}" graded ${r.correct ? "right" : "wrong"}` });
      }
    }
  }
  const passed = !issues.some((i) => i.severity === "fail");
  const serveable = !issues.some((i) => i.severity === "fail" && SERVE_BLOCKING.has(i.code));
  await db.update(s.itemTemplates).set({ sweep: { passed, serveable, issues, distinctAnswers: sweep.distinctAnswers } }).where(and(eq(s.itemTemplates.id, id), eq(s.itemTemplates.version, row.version)));
  invalidateContent();
  return { id, version: row.version, passed, issues, distinctAnswers: sweep.distinctAnswers, distinctInstances: sweep.distinctInstances };
}

export async function submitForReview(id: string, version: number) {
  await getDb().update(s.itemTemplates).set({ status: "in_review" }).where(and(eq(s.itemTemplates.id, id), eq(s.itemTemplates.version, version), eq(s.itemTemplates.status, "draft")));
  invalidateContent();
  return getTemplate(id);
}

/**
 * §16.2 — promotion with a change class. Cosmetic keeps history; substantive keeps
 * history but resets b; corrective voids every prior response and replays θ.
 */
export async function promoteTemplate(reviewerId: string, id: string, version: number, changeClass: "cosmetic" | "substantive" | "corrective" | null, confirm?: string) {
  const db = getDb();
  const [row] = await db.select().from(s.itemTemplates).where(and(eq(s.itemTemplates.id, id), eq(s.itemTemplates.version, version)));
  if (!row) throw new AppError("NOT_FOUND", "template");
  if (!row.sweep?.passed) throw new AppError("VALIDATION", "the seed sweep must pass before promotion");
  const priorLive = await db.select().from(s.itemTemplates).where(and(eq(s.itemTemplates.id, id), eq(s.itemTemplates.status, "live"), ne(s.itemTemplates.version, version)));
  if (priorLive.length && !changeClass) throw new AppError("VALIDATION", "choose a change class", "changeClass");
  if (changeClass === "corrective" && confirm !== `void ${id}`) throw new AppError("VALIDATION", `type "void ${id}" to confirm`, "confirm");
  const oldStats = priorLive.length ? (await db.select().from(s.itemStats).where(and(eq(s.itemStats.templateId, id), eq(s.itemStats.version, priorLive[0]!.version))))[0] : undefined;

  await db.transaction(async (tx) => {
    await tx.update(s.itemTemplates).set({ status: "live", changeClass, reviewerId, reviewedAt: new Date() }).where(and(eq(s.itemTemplates.id, id), eq(s.itemTemplates.version, version)));
    for (const p of priorLive) await tx.update(s.itemTemplates).set({ status: "retired" }).where(and(eq(s.itemTemplates.id, id), eq(s.itemTemplates.version, p.version)));
    // Cosmetic: the difficulty estimate carries over. Substantive: b resets to the band prior.
    const b = changeClass === "cosmetic" && oldStats ? oldStats.b : BAND_PRIORS[row.band as Band];
    await tx.insert(s.itemStats).values({ templateId: id, version, b }).onConflictDoUpdate({ target: [s.itemStats.templateId, s.itemStats.version], set: { b } });
  });
  let replayed = 0;
  if (changeClass === "corrective") replayed = await voidTemplateResponses(id, priorLive.map((p) => p.version), "corrective");
  invalidateContent();
  return { ok: true, replayedUsers: replayed };
}

export async function reviewQueue() {
  const db = getDb();
  const rows = await db.select().from(s.itemTemplates).where(eq(s.itemTemplates.status, "in_review")).orderBy(asc(s.itemTemplates.createdAt));
  return rows.map((r) => ({ id: r.id, version: r.version, skillId: r.skillId, band: r.band, type: r.type, createdAt: r.createdAt.toISOString(), sweepPassed: !!r.sweep?.passed, issues: r.sweep?.issues ?? [] }));
}

export async function reviewDecision(reviewerId: string, id: string, version: number, decision: "approve" | "send_back" | "discard", note?: string) {
  const db = getDb();
  if (decision === "approve") return promoteTemplate(reviewerId, id, version, "substantive");
  await db
    .update(s.itemTemplates)
    .set({ status: decision === "discard" ? "retired" : "draft", reviewerId, reviewedAt: new Date(), reviewNote: note ?? null })
    .where(and(eq(s.itemTemplates.id, id), eq(s.itemTemplates.version, version)));
  invalidateContent();
  return { ok: true };
}

// ── Flags (§12.4) ──────────────────────────────────────────────────────────

export async function flagQueue() {
  const db = getDb();
  const content = await getContent();
  const flags = await db.select().from(s.flags).where(eq(s.flags.status, "open")).orderBy(asc(s.flags.createdAt));
  const out = [];
  for (const f of flags) {
    if (f.targetType === "lesson_step") {
      const lesson = content.lessons.get(f.lessonSkillId!);
      const step = lesson?.steps.find((x) => x.id === f.stepId);
      out.push({ id: f.id, kind: "lesson_step" as const, createdAt: f.createdAt.toISOString(), note: f.note, skillId: f.lessonSkillId, lessonTitle: lesson?.title ?? f.lessonSkillId, stepId: f.stepId, stepTitle: step?.title ?? f.stepId, version: f.lessonVersion });
      continue;
    }
    const tpl = content.templateByKey.get(`${f.templateId}@${f.version}`);
    let instance = null;
    let submitted: string | null = null;
    if (tpl && f.seed !== null) {
      // The exact instance the user saw, reconstructed from (template, version, seed) — §8.3.
      const inst = buildInstance(tpl.payload, f.seed);
      instance = { stemHtml: renderTex(inst.stem), answerHtml: answerHtml(inst), options: inst.mcq?.options.map((o) => ({ html: renderTex(o.label), correct: o.correct, misconceptionId: o.misconceptionId })) ?? null, solutionHtml: solutionHtml(inst), params: inst.params };
      if (f.sessionItemId) {
        const [resp] = await db.select({ raw: s.responses.submittedRaw, correct: s.responses.correct }).from(s.responses).where(eq(s.responses.sessionItemId, f.sessionItemId));
        submitted = resp ? `${resp.raw ?? ""}${resp.correct ? " (marked correct)" : " (marked wrong)"}` : null;
      }
    }
    const [stats] = f.templateId ? await db.select().from(s.itemStats).where(and(eq(s.itemStats.templateId, f.templateId), eq(s.itemStats.version, f.version ?? 1))) : [];
    out.push({ id: f.id, kind: "item" as const, createdAt: f.createdAt.toISOString(), note: f.note, templateId: f.templateId, version: f.version, seed: f.seed, skillId: tpl?.skillId, instance, submitted, flagRate: stats && stats.responses ? stats.flagCount / stats.responses : null, responses: stats?.responses ?? 0 });
  }
  return out;
}

export async function resolveFlag(reviewerId: string, flagId: string, action: "dismiss" | "retire" | "edit") {
  const db = getDb();
  const [f] = await db.select().from(s.flags).where(eq(s.flags.id, flagId));
  if (!f) throw new AppError("NOT_FOUND", "flag");
  let replayedUsers = 0;
  if (action === "retire" && f.targetType === "item" && f.templateId) {
    await db.update(s.itemTemplates).set({ status: "retired" }).where(eq(s.itemTemplates.id, f.templateId));
    replayedUsers = await voidTemplateResponses(f.templateId, null, "retired");
    invalidateContent();
  }
  await db
    .update(s.flags)
    .set({ status: action === "dismiss" ? "dismissed" : action === "retire" ? "retired" : "edited", resolvedBy: reviewerId, resolvedAt: new Date() })
    .where(f.templateId ? and(eq(s.flags.templateId, f.templateId), eq(s.flags.status, "open")) : eq(s.flags.id, flagId));
  return { ok: true, replayedUsers };
}

/**
 * Retiring or correcting an item is immediate and retroactive: every response is
 * voided and each affected user's θ is rebuilt from what remains (§12.4, §16.3).
 */
export async function voidTemplateResponses(templateId: string, versions: number[] | null, cause: string): Promise<number> {
  const db = getDb();
  const where = versions ? and(eq(s.responses.templateId, templateId), inArray(s.responses.templateVersion, versions.length ? versions : [-1]), isNull(s.responses.voidedAt)) : and(eq(s.responses.templateId, templateId), isNull(s.responses.voidedAt));
  const affected = await db.selectDistinct({ userId: s.responses.userId }).from(s.responses).where(where);
  await db.update(s.responses).set({ voidedAt: new Date() }).where(where);
  let n = 0;
  for (const { userId } of affected) {
    if (!userId) continue;
    await replayUser(userId);
    n++;
  }
  await events.emit("item_voided", null, { template: templateId, cause, users: n });
  return n;
}

/**
 * Rebuild every skill state for a user from the surviving log, deterministically:
 * responses in order, lesson completions, placement seeding at placement end, and
 * assessment recalibration at assessment end. Used after voiding; never patched.
 */
export async function replayUser(userId: string): Promise<{ changed: { skillId: string; from: Level; to: Level }[] }> {
  const db = getDb();
  const content = await getContent();
  const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
  if (!user) return { changed: [] };
  const before = await loadStates(db, userId);
  const responses = await db.select().from(s.responses).where(and(eq(s.responses.userId, userId), isNull(s.responses.voidedAt))).orderBy(asc(s.responses.createdAt));
  const lessons = await db.select().from(s.lessonProgress).where(and(eq(s.lessonProgress.userId, userId), eq(s.lessonProgress.status, "completed")));
  const sessions = await db.select().from(s.sessions).where(and(eq(s.sessions.userId, userId), inArray(s.sessions.mode, ["placement", "assessment"])));

  type Ev = { at: number; order: number; run: (st: Map<string, SkillState>) => void };
  const evs: Ev[] = [];
  for (const r of responses) {
    const outcome: Outcome = { y: r.y, correct: r.correct, band: r.band as Band, b: r.bBefore, timedOut: r.timedOut, withinLimit: r.withinLimit, seenBefore: r.seenBefore, itemResponseCount: r.itemResponseCount, mode: r.mode as Outcome["mode"], misconceptionId: r.misconceptionId, ...(r.setSize ? { setSize: r.setSize } : {}) };
    evs.push({ at: r.createdAt.getTime(), order: 0, run: (st) => void applyToUser(st, content.skills, { skillId: r.skillId, outcome, at: r.createdAt }) });
  }
  for (const l of lessons) {
    if (!l.completedAt) continue;
    evs.push({ at: l.completedAt.getTime(), order: 1, run: (st) => st.set(l.skillId, applyLessonCompletion(st.get(l.skillId) ?? initialSkillState())) });
  }
  for (const x of sessions) {
    if (!x.endedAt) continue;
    const arch = archetypeFor(content, (x.config as { archetypeId?: string }).archetypeId);
    if (x.mode === "placement") {
      evs.push({ at: x.endedAt.getTime(), order: 2, run: (st) => { for (const [k, v] of seedInferred(st, content.skillList, Object.keys(arch.required))) st.set(k, v); } });
    } else {
      const inSession = responses.filter((r) => r.sessionId === x.id);
      evs.push({
        at: x.endedAt.getTime(),
        order: 2,
        run: (st) => {
          const bySkill = new Map<string, { correct: number; b: number }[]>();
          for (const r of inSession) bySkill.set(r.skillId, [...(bySkill.get(r.skillId) ?? []), { correct: r.y, b: r.bBefore }]);
          for (const [k, res] of bySkill) {
            const cur = st.get(k);
            const obs = observedTheta(res);
            if (cur && obs !== null) st.set(k, recalibrate(cur, obs));
          }
        },
      });
    }
  }
  evs.sort((a, b) => a.at - b.at || a.order - b.order);
  const states = new Map<string, SkillState>();
  for (const e of evs) e.run(states);

  const now = new Date();
  const changed: { skillId: string; from: Level; to: Level }[] = [];
  await db.transaction(async (tx) => {
    await tx.delete(s.userSkillState).where(eq(s.userSkillState.userId, userId));
    for (const [skillId, st] of states) {
      await saveState(tx as never, userId, skillId, st, now, interviewDateOf(user), { entryBand: before.get(skillId)?.entryBand ?? null });
      const was = (before.get(skillId)?.level ?? 0) as Level;
      if (was !== st.level) changed.push({ skillId, from: was, to: st.level });
    }
  });
  for (const c of changed) await events.emit("level_changed", userId, { skill: c.skillId, from: c.from, to: c.to, cause: "replay" });
  return { changed };
}

// ── Item health (§12.5) ────────────────────────────────────────────────────

export async function itemHealth() {
  const db = getDb();
  const content = await getContent();
  const stats = await db.select().from(s.itemStats);
  const live = new Map([...content.templateByKey.values()].filter((t) => t.status === "live" || t.status === "in_review").map((t) => [`${t.id}@${t.version}`, t]));
  const rows = stats
    .filter((x) => live.has(`${x.templateId}@${x.version}`))
    .map((x) => {
      const t = live.get(`${x.templateId}@${x.version}`)!;
      const p = x.responses ? x.correct / x.responses : null;
      const meanSec = x.responses ? x.totalElapsedMs / x.responses / 1000 : null;
      const flagRate = x.responses ? x.flagCount / x.responses : 0;
      const drift = x.b - BAND_PRIORS[t.band];
      const alerts: string[] = [];
      if (x.responses >= 30) {
        if (p !== null && (p < 0.35 || p > 0.85)) alerts.push("p-value out of range");
        if (x.discrimination !== null && x.discrimination < 0) alerts.push("negative discrimination");
        if (meanSec !== null && meanSec > t.timeLimitSec * 0.9) alerts.push("limit rarely met");
        if (Math.abs(drift) > 0.8) alerts.push("mis-banded");
      }
      if (flagRate > 0.05 && x.responses >= 20) alerts.push("flag rate > 5%");
      return { templateId: x.templateId, version: x.version, skillId: t.skillId, band: t.band, type: t.type, status: t.status, responses: x.responses, pValue: p, discrimination: x.discrimination, meanSec, limitSec: t.timeLimitSec, flagRate, b: x.b, drift, voids: x.voidCount, alerts };
    })
    .sort((a, b) => b.alerts.length - a.alerts.length || b.responses - a.responses);
  const calibration = await calibrationCurve();
  return { rows, calibration };
}

/** §14.3 — Brier score and a decile calibration curve on predicted p. */
export async function calibrationCurve() {
  const rows = await getDb()
    .select({ p: s.responses.pPred, y: s.responses.y })
    .from(s.responses)
    .where(and(isNull(s.responses.voidedAt), ne(s.responses.mode, "placement")));
  const brier = rows.length ? rows.reduce((a, r) => a + (r.p - r.y) ** 2, 0) / rows.length : null;
  const deciles = Array.from({ length: 10 }, (_, i) => {
    const inBin = rows.filter((r) => r.p >= i / 10 && (i === 9 ? r.p <= 1 : r.p < (i + 1) / 10));
    return { bin: i, n: inBin.length, predicted: inBin.length ? inBin.reduce((a, r) => a + r.p, 0) / inBin.length : null, actual: inBin.length ? inBin.reduce((a, r) => a + r.y, 0) / inBin.length : null };
  });
  return { n: rows.length, brier, deciles };
}

// ── Lessons: editor view and health (§19.7, §19.10) ────────────────────────

export async function lessonHealth() {
  const db = getDb();
  const content = await getContent();
  const progress = await db.select().from(s.lessonProgress);
  const stepEvents = await db.select().from(s.lessonStepEvents).where(inArray(s.lessonStepEvents.event, ["viewed", "check_attempt"]));
  const out = [];
  for (const lesson of content.lessons.values()) {
    const lp = progress.filter((p) => p.skillId === lesson.skill_id);
    const completed = lp.filter((p) => p.status === "completed");
    const started = lp.length;
    const dropOff = lesson.steps
      .map((st) => ({ id: st.id, title: st.title ?? st.id, viewers: new Set(stepEvents.filter((e) => e.skillId === lesson.skill_id && e.stepId === st.id && e.event === "viewed").map((e) => e.userId)).size }))
      .map((x, i, arr) => ({ ...x, lost: i ? Math.max(0, arr[i - 1]!.viewers - x.viewers) : 0 }));
    const checks = lesson.steps
      .filter((st) => st.type === "check")
      .map((st) => {
        const attempts = stepEvents.filter((e) => e.skillId === lesson.skill_id && e.stepId === st.id && e.event === "check_attempt");
        const firsts = attempts.filter((e) => (e.payload as { first_try?: boolean } | null)?.first_try).length;
        const users = new Set(attempts.map((e) => e.userId)).size;
        return { id: st.id, title: st.title ?? st.id, firstTryRate: users ? firsts / users : null, users };
      });
    // Lesson lift: actual vs predicted on each completer's first five practice attempts afterwards.
    const lifts: number[] = [];
    for (const c of completed) {
      if (!c.completedAt) continue;
      const rs = await db
        .select({ p: s.responses.pPred, correct: s.responses.correct })
        .from(s.responses)
        .where(and(eq(s.responses.userId, c.userId), eq(s.responses.skillId, lesson.skill_id), gt(s.responses.createdAt, c.completedAt), isNull(s.responses.voidedAt), eq(s.responses.mode, "practice")))
        .orderBy(asc(s.responses.createdAt))
        .limit(5);
      const l = lessonLift(rs);
      if (l !== null) lifts.push(l);
    }
    out.push({
      skillId: lesson.skill_id,
      title: lesson.title,
      version: lesson.version,
      status: lesson.status,
      steps: lesson.steps.map((st) => ({ id: st.id, type: st.type, title: st.title ?? st.id, addresses: st.addresses ?? [] })),
      started,
      completed: completed.length,
      completionRate: started ? completed.length / started : null,
      dropOff,
      checks,
      lift: lifts.length ? lifts.reduce((a, b) => a + b, 0) / lifts.length : null,
      liftN: lifts.length,
    });
  }
  return out;
}

// ── Nightly rollup ─────────────────────────────────────────────────────────

/**
 * Item stats rollup (tech spec §4): observed median solve time, and point-biserial
 * discrimination — correlation between getting this item right and the respondent's
 * session accuracy. Auto-flags negative discrimination; auto-retires a flag rate > 5%.
 */
export async function statsRollup() {
  const db = getDb();
  const since = new Date(Date.now() - 180 * 86400000);
  const rows = await db
    .select({ templateId: s.responses.templateId, version: s.responses.templateVersion, sessionId: s.responses.sessionId, y: s.responses.y, elapsed: s.responses.elapsedMs })
    .from(s.responses)
    .where(and(isNull(s.responses.voidedAt), gt(s.responses.createdAt, since)));
  const sessionAcc = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const a = sessionAcc.get(r.sessionId) ?? { sum: 0, n: 0 };
    a.sum += r.y;
    a.n++;
    sessionAcc.set(r.sessionId, a);
  }
  const byTemplate = new Map<string, typeof rows>();
  for (const r of rows) byTemplate.set(`${r.templateId}@${r.version}`, [...(byTemplate.get(`${r.templateId}@${r.version}`) ?? []), r]);
  let retired = 0;
  for (const [key, rs] of byTemplate) {
    const [templateId, v] = key.split("@") as [string, string];
    const version = Number(v);
    const times = rs.map((r) => r.elapsed).sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? null;
    let discrimination: number | null = null;
    if (rs.length >= 30) {
      // Rest-score: session accuracy excluding this item.
      const xs = rs.map((r) => {
        const a = sessionAcc.get(r.sessionId)!;
        return a.n > 1 ? (a.sum - r.y) / (a.n - 1) : 0.5;
      });
      const ys = rs.map((r) => r.y);
      discrimination = correlation(ys, xs);
    }
    await db.update(s.itemStats).set({ medianElapsedMs: median, discrimination, updatedAt: new Date() }).where(and(eq(s.itemStats.templateId, templateId), eq(s.itemStats.version, version)));
    if (discrimination !== null && discrimination < 0) {
      const [open] = await db.select({ id: s.flags.id }).from(s.flags).where(and(eq(s.flags.templateId, templateId), eq(s.flags.status, "open"), isNull(s.flags.userId)));
      if (!open) await db.insert(s.flags).values({ templateId, version, targetType: "item", note: `auto: negative discrimination (${discrimination.toFixed(2)})` });
    }
  }
  const hot = await db.select().from(s.itemStats).where(and(sql`${s.itemStats.responses} >= 20`, sql`${s.itemStats.flagCount}::float / greatest(${s.itemStats.responses}, 1) > 0.05`));
  for (const h of hot) {
    const [t] = await db.select({ status: s.itemTemplates.status }).from(s.itemTemplates).where(and(eq(s.itemTemplates.id, h.templateId), eq(s.itemTemplates.version, h.version)));
    if (t?.status === "live") {
      await db.update(s.itemTemplates).set({ status: "retired" }).where(and(eq(s.itemTemplates.id, h.templateId), eq(s.itemTemplates.version, h.version)));
      await voidTemplateResponses(h.templateId, [h.version], "auto-retired: flag rate");
      retired++;
    }
  }
  if (retired) invalidateContent();
  return { templates: byTemplate.size, retired };
}

function correlation(a: number[], b: number[]): number | null {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i]! - ma) * (b[i]! - mb);
    va += (a[i]! - ma) ** 2;
    vb += (b[i]! - mb) ** 2;
  }
  return va && vb ? cov / Math.sqrt(va * vb) : null;
}

export async function cleanup(now = new Date()) {
  const db = getDb();
  await db.delete(s.rateLimits).where(lt(s.rateLimits.windowStart, new Date(now.getTime() - 2 * 86400000)));
  await db.delete(s.exports).where(lt(s.exports.expiresAt, now));
  await db.delete(s.verificationTokens).where(lt(s.verificationTokens.expires, now));
  // Analytics events: 90 days in Postgres (tech spec §13).
  await db.delete(s.events).where(lt(s.events.createdAt, new Date(now.getTime() - 90 * 86400000)));
}
