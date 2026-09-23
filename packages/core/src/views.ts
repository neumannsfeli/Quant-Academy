/**
 * Read models for the learner screens (tech spec §8 read endpoints, §19.11).
 * Everything here is computed on read from ~40 state rows: no caches to invalidate.
 */
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { getDb, schema as s } from "@qa/db";
import {
  ASSESSMENT_UNLOCK_WORKING_SKILLS,
  BAND_PRIORS,
  LEVEL3_MIN_RETENTION,
  LEVEL3_STREAK,
  assessmentUnlock,
  isValidated,
  retention,
  type Band,
} from "@qa/scoring";
import { lessonCandidate } from "./composer";
import { archetypeFor, getContent, type Content } from "./content";
import { AppError } from "./errors";
import { previewPlan } from "./runner";
import { lastPassedAssessmentAt } from "./snapshots";
import { loadStates } from "./states";
import { learnUnlocked, readinessView, skillStatus, skillView, statusCounts, type SkillView } from "./status";
import { renderMarkdown, renderTex } from "./tex";

async function userRow(userId: string) {
  const [u] = await getDb().select().from(s.users).where(eq(s.users.id, userId));
  if (!u || u.deletedAt) throw new AppError("UNAUTHENTICATED");
  return u;
}

function liveSkills(content: Content) {
  return content.skillList.filter((k) => content.domainById.get(k.domainId)?.live);
}

// ── Home ───────────────────────────────────────────────────────────────────

export async function getHome(userId: string, now = new Date()) {
  const db = getDb();
  const [user, content] = await Promise.all([userRow(userId), getContent()]);
  const states = await loadStates(db, userId);
  const arch = archetypeFor(content, user.archetypeId);
  const view = readinessView(content, states, user.archetypeId, now);
  const skills = liveSkills(content).map((k) => skillView(content, k, states, arch, now, view.skillScores));

  const plan = await previewPlan(userId, now).catch(() => null);
  const fading = skills.filter((k) => k.fading).sort((a, b) => (a.retention ?? 1) - (b.retention ?? 1));
  const [openSession] = await db
    .select({ id: s.sessions.id, mode: s.sessions.mode, startedAt: s.sessions.startedAt })
    .from(s.sessions)
    .where(and(eq(s.sessions.userId, userId), isNull(s.sessions.endedAt)))
    .orderBy(desc(s.sessions.startedAt))
    .limit(1);
  const [lastAssess] = await db
    .select({ startedAt: s.sessions.startedAt })
    .from(s.sessions)
    .where(and(eq(s.sessions.userId, userId), eq(s.sessions.mode, "assessment")))
    .orderBy(desc(s.sessions.startedAt))
    .limit(1);
  const unlock = assessmentUnlock(states.values(), user.createdAt, lastAssess?.startedAt ?? null, now);
  const passedAt = await lastPassedAssessmentAt(userId);
  const hasPlacement = (await db.select({ id: s.sessions.id }).from(s.sessions).where(and(eq(s.sessions.userId, userId), eq(s.sessions.mode, "placement"))).limit(1)).length > 0;
  const lessonNext = plan?.lessonSkillId ? content.skills.get(plan.lessonSkillId) : null;
  const interviewPassed = user.interviewDate ? new Date(`${user.interviewDate}T23:59:59Z`).getTime() < now.getTime() : false;
  const [outcome] = interviewPassed ? await db.select({ id: s.outcomes.id }).from(s.outcomes).where(and(eq(s.outcomes.userId, userId), gte(s.outcomes.createdAt, new Date(`${user.interviewDate}T00:00:00Z`)))).limit(1) : [];

  // Home shows a sample of the map: per required domain, a few skills in curriculum order.
  const byDomain = view.domainRows.map((d) => {
    const inD = skills.filter((k) => k.domainId === d.id && k.required);
    const shown = [...inD].sort((a, b) => rank(b) - rank(a) || a.tier - b.tier).slice(0, 3).sort((a, b) => a.tier - b.tier || rank(b) - rank(a));
    return { id: d.id, name: d.name, ready: inD.filter((k) => k.level === 3).length, total: shown.length, skills: shown };
  });
  return {
    user: { id: user.id, email: user.email, name: user.name, archetypeId: arch.id, archetypeName: arch.name, onboarding: user.onboarding },
    firstRun: !hasPlacement && [...states.values()].every((st) => st.attempts === 0),
    readiness: {
      score: view.score,
      raw: view.rawScore,
      provisional: view.provisional,
      provisionalReason: view.provisionalReason ?? null,
      totalAttempts: view.totalAttempts,
      validated: isValidated(passedAt, now),
      validatedUntil: passedAt ? new Date(passedAt.getTime() + 21 * 86400000).toISOString() : null,
      domains: view.domainRows,
      weakest: view.weakest,
    },
    skills: {
      byDomain,
      counts: { total: skills.length, ready: skills.filter((k) => k.level === 3).length, locked: skills.filter((k) => k.status === "locked").length, started: skills.filter((k) => k.attempts > 0 || k.level > 0).length },
    },
    today: plan
      ? {
          minutes: plan.minutes,
          items: plan.items,
          counts: plan.counts,
          lesson: lessonNext ? { skillId: lessonNext.id, name: lessonNext.name, minutes: content.lessons.get(lessonNext.id)?.est_minutes ?? lessonNext.lessonMinutes } : null,
          empty: plan.slots.length === 0,
        }
      : null,
    fading: fading.map((k) => ({ id: k.id, name: k.name, retention: k.retention })),
    assessment: {
      unlocked: unlock.unlocked,
      workingSkills: unlock.workingSkills,
      needWorking: ASSESSMENT_UNLOCK_WORKING_SKILLS,
      attempts: unlock.attempts,
      daysSinceSignup: Math.floor(unlock.daysSinceSignup),
      nextAllowedAt: unlock.nextAllowedAt?.toISOString() ?? null,
      daysUntilValidationLapses: passedAt ? Math.max(0, Math.ceil((passedAt.getTime() + 21 * 86400000 - now.getTime()) / 86400000)) : null,
    },
    openSession: openSession ? { id: openSession.id, mode: openSession.mode, startedAt: openSession.startedAt.toISOString() } : null,
    outcomePrompt: interviewPassed && !outcome && user.prefs.shareOutcomes !== false,
    interviewDate: user.interviewDate,
  };
}

function rank(k: SkillView): number {
  return k.level * 10 + (k.status === "locked" ? -5 : 0) + (k.attempts > 0 ? 1 : 0);
}

// ── Skill page ─────────────────────────────────────────────────────────────

export async function getSkillPage(userId: string, skillId: string, now = new Date()) {
  const db = getDb();
  const [user, content] = await Promise.all([userRow(userId), getContent()]);
  const skill = content.skills.get(skillId);
  if (!skill) throw new AppError("NOT_FOUND", "skill");
  const states = await loadStates(db, userId);
  const arch = archetypeFor(content, user.archetypeId);
  const view = skillView(content, skill, states, arch, now);
  const st = states.get(skillId);
  const lesson = content.lessons.get(skillId);
  const [progress] = await db.select().from(s.lessonProgress).where(and(eq(s.lessonProgress.userId, userId), eq(s.lessonProgress.skillId, skillId)));
  const reading = content.readings.get(skillId);
  const requiredBand = (arch.required[skillId] ?? 3) as Band;
  const r = st ? retention(st, now) : null;
  const trap = lesson?.steps.find((x) => x.type === "trap");
  const templates = content.templatesBySkill.get(skillId) ?? [];
  const recent = await db
    .select({ correct: s.responses.correct, band: s.responses.band, createdAt: s.responses.createdAt, withinLimit: s.responses.withinLimit })
    .from(s.responses)
    .where(and(eq(s.responses.userId, userId), eq(s.responses.skillId, skillId), isNull(s.responses.voidedAt)))
    .orderBy(desc(s.responses.createdAt))
    .limit(10);
  return {
    skill: { id: skill.id, name: skill.name, domainId: skill.domainId, domainName: skill.domainName, band: skill.band, importance: skill.importance, minutes: lesson?.est_minutes ?? skill.lessonMinutes },
    view,
    state: {
      theta: st?.theta ?? null,
      target: BAND_PRIORS[requiredBand] + 1,
      requiredBand,
      level: st?.level ?? 0,
      coldStreak: st?.coldStreak ?? 0,
      retention: r,
      attempts: st?.attempts ?? 0,
      inferred: st?.inferred ?? false,
      criteria: {
        streak: Math.min(st?.coldStreak ?? 0, LEVEL3_STREAK),
        streakNeeded: LEVEL3_STREAK,
        bandOk: (st?.recent?.[0]?.band ?? 0) >= 3,
        limitOk: !!recent[0]?.withinLimit,
        retentionOk: r !== null && r >= LEVEL3_MIN_RETENTION,
        minRetention: LEVEL3_MIN_RETENTION,
      },
    },
    lesson: lesson
      ? {
          title: lesson.title,
          steps: lesson.steps.map((x) => ({ id: x.id, type: x.type, title: x.title ?? x.type, done: progress?.viewed.includes(x.id) ?? false })),
          status: progress?.status ?? "not_started",
          firstTry: progress ? { right: progress.firstTryChecks, total: lesson.steps.filter((x) => x.type === "check").length } : null,
          entryBand: states.get(skillId)?.entryBand ?? null,
          keyResultsHtml: lesson.key_results.map(renderTex),
          trapHtml: trap && trap.type === "trap" ? renderTex(trap.explanation) : null,
          trapTitle: trap?.title ?? null,
        }
      : null,
    readingHtml: reading ? renderMarkdown(reading.body) : null,
    readingKind: reading?.kind ?? null,
    requires: skill.prereqIds.map((p) => ({ id: p, name: content.skills.get(p)?.name ?? p, level: states.get(p)?.level ?? 0, status: skillStatus(content.skills.get(p)!, states) })),
    unlocks: skill.dependentIds.map((d) => ({ id: d, name: content.skills.get(d)?.name ?? d })),
    practice: { unlocked: view.practiceUnlocked, templates: templates.length, bands: [...new Set(templates.map((t) => t.band))].sort() },
    learnUnlocked: learnUnlocked(skill, states),
    history: recent.map((x) => ({ correct: x.correct, band: x.band, at: x.createdAt.toISOString() })),
  };
}

// ── Learn ──────────────────────────────────────────────────────────────────

export async function getLearnPaths(userId: string, now = new Date()) {
  const db = getDb();
  const [user, content] = await Promise.all([userRow(userId), getContent()]);
  const states = await loadStates(db, userId);
  const arch = archetypeFor(content, user.archetypeId);
  const progress = await db.select().from(s.lessonProgress).where(eq(s.lessonProgress.userId, userId));
  const byId = new Map(progress.map((p) => [p.skillId, p]));
  const view = readinessView(content, states, user.archetypeId, now);
  const doneSet = new Set(progress.filter((p) => p.status === "completed" || p.status === "skipped").map((p) => p.skillId));
  const next = lessonCandidate({ content, states, arch, weakestDomainId: view.weakestDomain, lessonsDone: doneSet });
  const domains = content.domains.map((d) => {
    const skills = content.skillList.filter((k) => k.domainId === d.id);
    const rows = skills.map((k, i) => {
      const v = skillView(content, k, states, arch, now);
      const lp = byId.get(k.id);
      return {
        index: i + 1,
        id: k.id,
        name: k.name,
        minutes: content.lessons.get(k.id)?.est_minutes ?? k.lessonMinutes,
        hasLesson: content.lessons.has(k.id),
        steps: content.lessons.get(k.id)?.steps.length ?? 0,
        learnStatus: v.level >= 1 ? "learned" : v.status === "locked" ? "locked" : lp?.status === "in_progress" ? "in_progress" : "ready",
        justNow: !!lp?.completedAt && now.getTime() - lp.completedAt.getTime() < 6 * 3600_000,
        upNext: next?.id === k.id,
        level: v.level,
        levelName: v.levelName,
        practiceUnlocked: v.practiceUnlocked,
        lockedReason: v.status === "locked" ? v.detail : null,
      };
    });
    return {
      id: d.id,
      name: d.name,
      short: d.short,
      live: d.live,
      learned: rows.filter((r) => r.level >= 1).length,
      proved: rows.filter((r) => r.level >= 2).length,
      ready: rows.filter((r) => r.level === 3).length,
      total: rows.length,
      rows,
    };
  });
  return {
    domains,
    upNext: next ? { id: next.id, name: next.name, domainId: next.domainId, minutes: content.lessons.get(next.id)!.est_minutes, steps: content.lessons.get(next.id)!.steps.length, widget: content.lessons.get(next.id)!.steps.find((x) => x.type === "interactive")?.type === "interactive" } : null,
  };
}

export async function getReviewSheet(userId: string) {
  const db = getDb();
  const content = await getContent();
  const states = await loadStates(db, userId);
  return {
    domains: content.domains
      .filter((d) => d.live)
      .map((d) => {
        const skills = content.skillList.filter((k) => k.domainId === d.id);
        const learned = skills.filter((k) => (states.get(k.id)?.level ?? 0) >= 1);
        return {
          id: d.id,
          name: d.name,
          learned: learned.length,
          total: skills.length,
          entries: learned
            .filter((k) => content.lessons.has(k.id))
            .map((k) => ({ skillId: k.id, name: k.name, resultsHtml: content.lessons.get(k.id)!.key_results.map(renderTex) })),
          learnedWithoutPath: learned.filter((k) => !content.lessons.has(k.id)).map((k) => k.name),
          notYet: skills.filter((k) => (states.get(k.id)?.level ?? 0) < 1).map((k) => k.name),
        };
      }),
  };
}

// ── Progress ───────────────────────────────────────────────────────────────

export async function getProgressMap(userId: string, now = new Date()) {
  const db = getDb();
  const [user, content] = await Promise.all([userRow(userId), getContent()]);
  const states = await loadStates(db, userId);
  const arch = archetypeFor(content, user.archetypeId);
  const counts = statusCounts(content, states, now);
  const live = liveSkills(content);
  const lanes = content.domains.map((d) => {
    const skills = content.skillList.filter((k) => k.domainId === d.id).map((k) => skillView(content, k, states, arch, now));
    const tiers = [...new Set(skills.map((k) => k.tier))].sort((a, b) => a - b).map((t) => ({ tier: t + 1, skills: skills.filter((k) => k.tier === t) }));
    return {
      id: d.id,
      name: d.name,
      live: d.live,
      weight: arch.weights[d.id] ?? 0,
      learned: skills.filter((k) => k.level >= 1).length,
      proved: skills.filter((k) => k.level >= 2).length,
      total: skills.length,
      tiers,
    };
  });
  const learned = live.filter((k) => (states.get(k.id)?.level ?? 0) >= 1).length;
  const proved = live.filter((k) => (states.get(k.id)?.level ?? 0) >= 2).length;
  return {
    archetypeName: arch.name,
    total: live.length,
    counts: { learned, proved, interviewReady: counts.interview_ready ?? 0, fading: counts.fading ?? 0, locked: counts.locked ?? 0 },
    lanes: lanes.filter((l) => l.live || l.total > 0),
    skillNames: Object.fromEntries(content.skillList.map((k) => [k.id, k.name])),
  };
}

export async function getProgressHistory(userId: string, days = 90, now = new Date()) {
  const db = getDb();
  const [user, content] = await Promise.all([userRow(userId), getContent()]);
  const since = new Date(now.getTime() - days * 86400000);
  const snaps = await db
    .select()
    .from(s.readinessSnapshots)
    .where(and(eq(s.readinessSnapshots.userId, userId), gte(s.readinessSnapshots.date, since.toISOString().slice(0, 10))))
    .orderBy(s.readinessSnapshots.date);
  const sessions = await db
    .select()
    .from(s.sessions)
    .where(and(eq(s.sessions.userId, userId), gte(s.sessions.startedAt, since)))
    .orderBy(desc(s.sessions.startedAt));
  const lessonRows = await db
    .select()
    .from(s.lessonProgress)
    .where(and(eq(s.lessonProgress.userId, userId), inArray(s.lessonProgress.status, ["completed"])));
  const refreshers = await db
    .select()
    .from(s.remediation)
    .where(and(eq(s.remediation.userId, userId), eq(s.remediation.resolution, "completed")));
  const view = readinessView(content, await loadStates(db, userId), user.archetypeId, now);
  const weakest = view.weakest?.id ?? null;

  type Entry = { at: string; kind: string; title: string; detail: string; delta: number | null; firstScore?: number | null };
  const entries: Entry[] = [];
  for (const x of sessions) {
    const sum = x.summary as { items?: number; accuracy?: number; readinessAfter?: number | null; assessment?: { passed: boolean; composite: number } } | null;
    const delta = x.readinessBefore !== null && x.readinessAfter !== null ? x.readinessAfter - x.readinessBefore : null;
    entries.push({
      at: x.startedAt.toISOString(),
      kind: x.mode,
      title: `${sum?.items ?? 0} items${sum?.accuracy !== undefined ? ` · ${Math.round((sum.accuracy ?? 0) * 100)}%` : ""}`,
      detail: x.mode === "assessment" && sum?.assessment ? (sum.assessment.passed ? `passed · ${sum.assessment.composite}%` : `not passed · ${sum.assessment.composite}%`) : x.endedAt ? "" : "in progress",
      delta: x.mode === "placement" ? null : delta,
      firstScore: x.mode === "placement" ? x.readinessAfter : undefined,
    });
  }
  for (const l of lessonRows) {
    entries.push({ at: (l.completedAt ?? l.startedAt).toISOString(), kind: "lesson", title: content.skills.get(l.skillId)?.name ?? l.skillId, detail: `${l.firstTryChecks}/${content.lessons.get(l.skillId)?.steps.filter((x) => x.type === "check").length ?? 0} first try`, delta: null });
  }
  for (const r of refreshers) {
    entries.push({ at: (r.resolvedAt ?? r.createdAt).toISOString(), kind: "refresher", title: content.skills.get(r.skillId)?.name ?? r.skillId, detail: "", delta: null });
  }
  entries.sort((a, b) => b.at.localeCompare(a.at));

  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const weekSessions = sessions.filter((x) => x.startedAt >= weekAgo && x.mode !== "placement");
  const weekResponses = weekSessions.reduce((a, x) => a + ((x.summary as { items?: number } | null)?.items ?? 0), 0);
  const weekCorrect = weekSessions.reduce((a, x) => a + ((x.summary as { correct?: number } | null)?.correct ?? 0), 0);
  const firstSnap = snaps.find((x) => x.date >= weekAgo.toISOString().slice(0, 10));
  return {
    snapshots: snaps.map((x) => ({ date: x.date, readiness: x.readiness, raw: x.rawReadiness, provisional: x.provisional, validated: x.validated, weakest: weakest ? x.domainScores[weakest] ?? null : null, counts: x.statusCounts, event: x.event })),
    weakestDomain: view.weakest,
    today: { readiness: view.score, raw: view.rawScore, provisional: view.provisional },
    week: {
      lessons: lessonRows.filter((l) => l.completedAt && l.completedAt >= weekAgo).length,
      practice: weekResponses,
      accuracy: weekResponses ? weekCorrect / weekResponses : null,
      readinessDelta: firstSnap && view.score !== null && firstSnap.readiness !== null ? view.score - firstSnap.readiness : null,
    },
    sessions: entries.slice(0, 40),
  };
}
