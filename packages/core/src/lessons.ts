/**
 * Tech spec §19.3 — the lesson player. Checks are graded server-side with the same
 * parser as practice, and answers never reach the client. Learn-mode events never
 * enter the scoring core, with one routed exception: completing a path raises the
 * skill to Familiar through scoring.applyLessonCompletion, so there is still one
 * writer of levels and θ is untouched (§19.2).
 */
import { and, count, eq, isNull } from "drizzle-orm";
import { getDb, schema as s } from "@qa/db";
import { Prng, checkNumeric, resolveTolerance } from "@qa/items";
import {
  canComplete,
  emptyProgress,
  entryBand,
  firstTryRate,
  gradeableKeys,
  nextStep,
  refresherSteps,
  type Lesson,
  type LessonProgress,
  type LessonStep,
} from "@qa/learning";
import { applyLessonCompletion, initialSkillState } from "@qa/scoring";
import { getContent, type Content } from "./content";
import { AppError } from "./errors";
import { events } from "./events";
import { gradeSymbolic } from "./grading";
import { interviewDateOf, loadStates, saveState } from "./states";
import { learnUnlocked } from "./status";
import { renderInline, renderMarkdown, renderTex } from "./tex";

type ProgressRow = typeof s.lessonProgress.$inferSelect;

function toProgress(row: ProgressRow | undefined): LessonProgress {
  if (!row) return emptyProgress();
  return { viewed: new Set(row.viewed), solved: new Set(row.solved), firstTry: new Set(row.firstTry), attempted: new Set(row.attempted) };
}

function lessonOrThrow(content: Content, skillId: string): Lesson {
  const l = content.lessons.get(skillId);
  if (!l) throw new AppError("NOT_FOUND", "no learning path for this skill yet");
  return l;
}

/** MCQ options for a check, in a stable per-step order. */
function checkOptions(lesson: Lesson, step: Extract<LessonStep, { type: "check" }>) {
  if (step.check.type !== "mcq") return [];
  const raw = [{ label: step.check.answer_label, correct: true }, ...step.check.distractors.map((d) => ({ label: d.label, correct: false, feedback: d.feedback, misconceptionId: d.misconception_id }))];
  const rng = Prng.forInstance(`${lesson.skill_id}:${step.id}`, lesson.version, 1);
  return rng.shuffle(raw).map((o, i) => ({ ...o, id: "ABCDEFGH"[i]! }));
}

/** The client projection of a step: no answers, no correct flags, no explanations before an attempt. */
export function clientStep(lesson: Lesson, step: LessonStep, progress: LessonProgress) {
  const base = { id: step.id, type: step.type, title: step.title ?? null, minutes: step.minutes ?? null, addresses: step.addresses ?? [] };
  switch (step.type) {
    case "concept":
    case "summary":
      return { ...base, bodyHtml: renderMarkdown(step.body), keyResultsHtml: step.type === "summary" ? lesson.key_results.map(renderTex) : undefined };
    case "interactive":
      return { ...base, bodyHtml: renderMarkdown(step.body), widget: step.widget, config: step.config, noteHtml: step.note ? renderInline(step.note) : null };
    case "worked":
      return {
        ...base,
        problemHtml: renderInline(step.problem),
        steps: step.steps.map((st, i) => ({
          html: renderMarkdown(st.text),
          selfExplain: st.self_explain
            ? { promptHtml: renderInline(st.self_explain.prompt), options: st.self_explain.options.map((o, j) => ({ id: String(j), html: renderInline(o.text) })), answered: progress.solved.has(`${step.id}$${i}`) }
            : null,
        })),
      };
    case "faded":
      return {
        ...base,
        problemHtml: renderInline(step.problem),
        steps: step.steps.map((st, i) =>
          "blank" in st
            ? { blank: true, index: i, promptHtml: renderInline(st.blank.prompt), hints: st.blank.hints?.length ?? 0, solved: progress.solved.has(`${step.id}#${i}`) }
            : { blank: false, index: i, html: renderMarkdown(st.text) },
        ),
      };
    case "check":
      return {
        ...base,
        transfer: !!step.transfer,
        kind: step.check.type,
        stemHtml: renderInline(step.check.stem),
        options: checkOptions(lesson, step).map((o) => ({ id: o.id, html: renderInline(o.label) })),
        hints: step.check.hints?.length ?? 0,
        solved: progress.solved.has(step.id),
        firstTry: progress.firstTry.has(step.id),
        attempted: progress.attempted.has(step.id),
      };
    case "trap":
      return { ...base, promptHtml: renderInline(step.prompt), flawed: step.flawed_solution.map((f) => renderInline(f)), solved: progress.solved.has(step.id) };
  }
}

export async function getLesson(userId: string, skillId: string) {
  const db = getDb();
  const content = await getContent();
  const lesson = lessonOrThrow(content, skillId);
  const skill = content.skills.get(skillId)!;
  const [row] = await db.select().from(s.lessonProgress).where(and(eq(s.lessonProgress.userId, userId), eq(s.lessonProgress.skillId, skillId)));
  const progress = toProgress(row);
  const states = await loadStates(db, userId);
  const resume = nextStep(lesson, progress);
  return {
    skillId,
    skillName: skill.name,
    domainName: skill.domainName,
    title: lesson.title,
    version: lesson.version,
    estMinutes: lesson.est_minutes,
    unlocked: learnUnlocked(skill, states),
    status: row?.status ?? "not_started",
    resumeStepId: resume === "complete" ? lesson.steps[lesson.steps.length - 1]!.id : resume,
    canComplete: canComplete(lesson, progress),
    steps: lesson.steps.map((st) => ({ ...clientStep(lesson, st, progress), viewed: progress.viewed.has(st.id) })),
    keyResultsHtml: lesson.key_results.map(renderTex),
    misconceptionsCovered: new Set(lesson.steps.flatMap((st) => st.addresses ?? [])).size,
    firstTry: { right: lesson.steps.filter((st) => st.type === "check" && progress.firstTry.has(st.id)).length, total: lesson.steps.filter((st) => st.type === "check").length },
  };
}

async function mutateProgress(userId: string, lesson: Lesson, fn: (p: LessonProgress, row: ProgressRow | undefined) => void | Promise<void>) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(s.lessonProgress)
      .where(and(eq(s.lessonProgress.userId, userId), eq(s.lessonProgress.skillId, lesson.skill_id)))
      .for("update");
    const p = toProgress(row);
    await fn(p, row);
    const values = {
      userId,
      skillId: lesson.skill_id,
      lessonVersion: lesson.version,
      status: row?.status === "completed" ? "completed" : "in_progress",
      currentStepId: (() => {
        const n = nextStep(lesson, p);
        return n === "complete" ? null : n;
      })(),
      viewed: [...p.viewed],
      solved: [...p.solved],
      firstTry: [...p.firstTry],
      attempted: [...p.attempted],
      totalChecks: gradeableKeys(lesson).length,
      firstTryChecks: [...p.firstTry].length,
    };
    await tx.insert(s.lessonProgress).values(values).onConflictDoUpdate({ target: [s.lessonProgress.userId, s.lessonProgress.skillId], set: values });
    return p;
  });
}

export async function startLesson(userId: string, skillId: string) {
  const content = await getContent();
  const lesson = lessonOrThrow(content, skillId);
  const states = await loadStates(getDb(), userId);
  if (!learnUnlocked(content.skills.get(skillId)!, states)) throw new AppError("PREREQ_NOT_MET", "learn the prerequisites first");
  await mutateProgress(userId, lesson, () => {});
  await events.emit("lesson_started", userId, { skill: skillId, version: lesson.version });
  return getLesson(userId, skillId);
}

export async function viewStep(userId: string, skillId: string, stepId: string, review = false) {
  const content = await getContent();
  const lesson = lessonOrThrow(content, skillId);
  if (!lesson.steps.some((x) => x.id === stepId)) throw new AppError("NOT_FOUND", "step");
  const p = await mutateProgress(userId, lesson, (p) => {
    p.viewed.add(stepId);
  });
  await getDb().insert(s.lessonStepEvents).values({ userId, skillId, lessonVersion: lesson.version, stepId, event: "viewed", payload: review ? { review: true } : null });
  await events.emit(review ? "targeted_review_opened" : "lesson_step_viewed", userId, { skill: skillId, step: stepId });
  const n = nextStep(lesson, p);
  return { next: n, canComplete: canComplete(lesson, p) };
}

export type AttemptResult = {
  correct: boolean;
  feedbackHtml: string | null;
  hintsRemaining: number;
  solutionAvailable: boolean;
  solutionHtml: string | null;
  firstTry: boolean;
  explanationHtml?: string | null;
};

/**
 * Attempt a check, a faded blank (`part` = blank index), a worked-example
 * self-explanation (`part` = step index), or a trap (`raw` = the step number).
 */
export async function attemptStep(userId: string, skillId: string, stepId: string, raw: string, part?: number): Promise<AttemptResult> {
  const content = await getContent();
  const lesson = lessonOrThrow(content, skillId);
  const step = lesson.steps.find((x) => x.id === stepId);
  if (!step) throw new AppError("NOT_FOUND", "step");
  const db = getDb();

  let key = stepId;
  let correct = false;
  let feedback: string | null = null;
  let solution: string | null = null;
  let hints = 0;
  let explanation: string | null = null;

  if (step.type === "check") {
    hints = step.check.hints?.length ?? 0;
    solution = step.check.solution;
    if (step.check.type === "numeric") {
      const answer = evalLessonAnswer(step.check.answer);
      const v = checkNumeric(raw, answer, resolveTolerance({ abs: step.check.tolerance?.abs ?? 1e-6, rel: step.check.tolerance?.rel ?? 1e-6 }));
      if (v.status === "invalid") throw new AppError("NOT_A_NUMBER", v.reason, "raw");
      correct = v.correct;
      if (!correct) {
        const fb = (step.check.feedback ?? []).find((f) => {
          const target = typeof f.answer === "number" ? f.answer : evalLessonAnswer(String(f.answer));
          return Math.abs(v.value - target) <= Math.max(1e-6, 1e-6 * Math.abs(target));
        });
        feedback = fb?.text ?? null;
      }
    } else {
      const opt = checkOptions(lesson, step).find((o) => o.id === raw.trim());
      if (!opt) throw new AppError("VALIDATION", "choose an option", "raw");
      correct = opt.correct;
      feedback = correct ? null : ("feedback" in opt ? opt.feedback ?? null : null);
    }
  } else if (step.type === "faded") {
    const st = part !== undefined ? step.steps[part] : undefined;
    if (!st || !("blank" in st)) throw new AppError("VALIDATION", "no such blank");
    key = `${stepId}#${part}`;
    hints = st.blank.hints?.length ?? 0;
    solution = st.blank.solution ?? null;
    const v = checkNumeric(raw, evalLessonAnswer(st.blank.answer), resolveTolerance({ abs: 1e-6, rel: 1e-6 }));
    if (v.status === "invalid") {
      // A blank may ask for an expression: let the grader decide.
      const g = await gradeSymbolic(raw.trim(), st.blank.answer, [], {});
      if (g.kind === "void") throw new AppError("GRADER_UNAVAILABLE");
      correct = g.correct;
    } else correct = v.correct;
  } else if (step.type === "worked") {
    const st = part !== undefined ? step.steps[part] : undefined;
    if (!st?.self_explain) throw new AppError("VALIDATION", "no question on that step");
    key = `${stepId}$${part}`;
    const opt = st.self_explain.options[Number(raw)];
    if (!opt) throw new AppError("VALIDATION", "choose an option", "raw");
    correct = opt.correct;
    feedback = opt.feedback;
  } else if (step.type === "trap") {
    const chosen = Number(raw);
    if (!Number.isInteger(chosen)) throw new AppError("VALIDATION", "choose a step", "raw");
    correct = chosen === step.error_step;
    explanation = step.explanation;
    feedback = correct ? null : "That step holds up. Look for the one that quietly assumes something false.";
  } else {
    throw new AppError("VALIDATION", "this step has nothing to answer");
  }

  let firstTry = false;
  let attemptsSoFar = 0;
  await mutateProgress(userId, lesson, (p) => {
    firstTry = correct && !p.attempted.has(key);
    if (firstTry && step.type === "check") p.firstTry.add(key);
    p.attempted.add(key);
    p.viewed.add(stepId);
    if (correct) p.solved.add(key);
  });
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(s.lessonStepEvents)
    .where(and(eq(s.lessonStepEvents.userId, userId), eq(s.lessonStepEvents.skillId, skillId), eq(s.lessonStepEvents.stepId, stepId), eq(s.lessonStepEvents.event, "check_attempt")));
  attemptsSoFar = Number(n) + 1;
  await db.insert(s.lessonStepEvents).values({ userId, skillId, lessonVersion: lesson.version, stepId, event: "check_attempt", payload: { key, correct, first_try: firstTry } });
  if (step.type === "check") await events.emit("lesson_check_answered", userId, { skill: skillId, step: stepId, first_try: firstTry, attempts: attemptsSoFar });

  // The worked solution is available after a second wrong attempt, or on request (§19.3).
  const solutionAvailable = !!solution && (correct || attemptsSoFar >= 2);
  return {
    correct,
    feedbackHtml: feedback ? renderInline(feedback) : null,
    hintsRemaining: hints,
    solutionAvailable,
    solutionHtml: correct && solution ? renderInline(solution) : null,
    firstTry,
    ...(step.type === "trap" ? { explanationHtml: correct || attemptsSoFar >= 2 ? renderInline(explanation ?? "") : null } : {}),
  };
}

function evalLessonAnswer(expr: string): number {
  const v = checkNumeric(expr, 0, resolveTolerance());
  if (v.status === "invalid") throw new AppError("VALIDATION", `lesson answer "${expr}" does not evaluate`);
  return v.value;
}

export async function hintStep(userId: string, skillId: string, stepId: string, index: number, part?: number) {
  const content = await getContent();
  const lesson = lessonOrThrow(content, skillId);
  const step = lesson.steps.find((x) => x.id === stepId);
  const hints = step?.type === "check" ? step.check.hints ?? [] : step?.type === "faded" && part !== undefined && step.steps[part] && "blank" in step.steps[part]! ? (step.steps[part] as { blank: { hints?: string[] } }).blank.hints ?? [] : [];
  const hint = hints[index];
  if (!hint) throw new AppError("NOT_FOUND", "no more hints");
  await getDb().insert(s.lessonStepEvents).values({ userId, skillId, lessonVersion: lesson.version, stepId, event: "hint", payload: { index, part: part ?? null } });
  return { index, total: hints.length, html: renderInline(hint) };
}

export async function revealStep(userId: string, skillId: string, stepId: string, part?: number) {
  const content = await getContent();
  const lesson = lessonOrThrow(content, skillId);
  const step = lesson.steps.find((x) => x.id === stepId);
  if (!step) throw new AppError("NOT_FOUND", "step");
  let html: string | null = null;
  if (step.type === "check") html = renderInline(step.check.solution);
  else if (step.type === "faded" && part !== undefined && step.steps[part] && "blank" in step.steps[part]!) {
    const b = (step.steps[part] as { blank: { solution?: string; answer: string } }).blank;
    html = renderInline(b.solution ?? `The answer is $${b.answer}$.`);
  } else if (step.type === "trap") html = renderInline(`Step ${step.error_step + 1} is wrong. ${step.explanation}`);
  if (!html) throw new AppError("NOT_FOUND", "nothing to reveal");
  await getDb().insert(s.lessonStepEvents).values({ userId, skillId, lessonVersion: lesson.version, stepId, event: "reveal", payload: { part: part ?? null } });
  return { html };
}

/** The server re-checks canComplete; a hostile client cannot skip steps (§19.9). */
export async function completeLesson(userId: string, skillId: string) {
  const db = getDb();
  const content = await getContent();
  const lesson = lessonOrThrow(content, skillId);
  const [row] = await db.select().from(s.lessonProgress).where(and(eq(s.lessonProgress.userId, userId), eq(s.lessonProgress.skillId, skillId)));
  const p = toProgress(row);
  if (!canComplete(lesson, p)) throw new AppError("LESSON_INCOMPLETE", "every step must be seen and every check answered");
  const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
  const states = await loadStates(db, userId, [skillId]);
  const before = states.get(skillId) ?? initialSkillState();
  const after = applyLessonCompletion(before);
  const rate = firstTryRate(lesson, p);
  const now = new Date();
  await saveState(db, userId, skillId, after, now, interviewDateOf(user!), { entryBand: entryBand(rate) });
  if (row?.status !== "completed") {
    await db.update(s.lessonProgress).set({ status: "completed", completedAt: now }).where(and(eq(s.lessonProgress.userId, userId), eq(s.lessonProgress.skillId, skillId)));
    await events.emit("lesson_completed", userId, { skill: skillId, first_try_rate: rate, minutes: row ? Math.round((now.getTime() - row.startedAt.getTime()) / 60000) : null });
    if (after.level !== before.level) await events.emit("level_changed", userId, { skill: skillId, from: before.level, to: after.level, cause: "lesson" });
  }
  await markLessonSlots(userId, skillId, "done");
  return { levelBefore: before.level, levelAfter: after.level, entryBand: entryBand(rate), firstTryRate: rate };
}

export async function skipLesson(userId: string, skillId: string) {
  const content = await getContent();
  const lesson = lessonOrThrow(content, skillId);
  const db = getDb();
  await mutateProgress(userId, lesson, () => {});
  await db.update(s.lessonProgress).set({ status: "skipped" }).where(and(eq(s.lessonProgress.userId, userId), eq(s.lessonProgress.skillId, skillId), eq(s.lessonProgress.status, "in_progress")));
  await markLessonSlots(userId, skillId, "skipped");
  await events.emit("lesson_skipped", userId, { skill: skillId });
  return { ok: true };
}

async function markLessonSlots(userId: string, skillId: string, status: "done" | "skipped") {
  await getDb()
    .update(s.sessionItems)
    .set({ status })
    .where(and(eq(s.sessionItems.userId, userId), eq(s.sessionItems.skillId, skillId), eq(s.sessionItems.kind, "lesson"), eq(s.sessionItems.status, "planned")));
}

// ── Refreshers (§19.6) ─────────────────────────────────────────────────────

export async function getRefresher(userId: string, skillId: string) {
  const content = await getContent();
  const lesson = lessonOrThrow(content, skillId);
  const [rem] = await getDb()
    .select()
    .from(s.remediation)
    .where(and(eq(s.remediation.userId, userId), eq(s.remediation.skillId, skillId), isNull(s.remediation.resolvedAt)));
  const ids = refresherSteps(lesson, rem?.misconceptionId ?? null);
  const full = await getLesson(userId, skillId);
  return { ...full, cause: rem?.cause ?? null, steps: full.steps.filter((st) => ids.includes(st.id)) };
}

export async function finishRefresher(userId: string, skillId: string, resolution: "completed" | "skipped") {
  const db = getDb();
  await db
    .update(s.remediation)
    .set({ resolvedAt: new Date(), resolution })
    .where(and(eq(s.remediation.userId, userId), eq(s.remediation.skillId, skillId), isNull(s.remediation.resolvedAt)));
  await db
    .update(s.sessionItems)
    .set({ status: resolution === "completed" ? "done" : "skipped" })
    .where(and(eq(s.sessionItems.userId, userId), eq(s.sessionItems.skillId, skillId), eq(s.sessionItems.kind, "refresher"), eq(s.sessionItems.status, "planned")));
  await events.emit(resolution === "completed" ? "refresher_completed" : "refresher_skipped", userId, { skill: skillId });
  return { ok: true };
}

export async function flagLessonStep(userId: string, skillId: string, stepId: string, note: string | null) {
  const content = await getContent();
  const lesson = lessonOrThrow(content, skillId);
  await getDb().insert(s.flags).values({ userId, targetType: "lesson_step", lessonSkillId: skillId, lessonVersion: lesson.version, stepId, note: note?.slice(0, 2000) ?? null });
  return { ok: true };
}
