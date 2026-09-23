/**
 * Tech spec §19.11 — derived skill status, and the readiness view every page reads.
 * Readiness is computed on read (tech spec §5): a few dozen rows and some arithmetic.
 */
import {
  DOMAIN_TARGET,
  LEVEL3_STREAK,
  REVIEW_THRESHOLD,
  readiness,
  retention,
  type ReadinessResult,
  type SkillState,
} from "@qa/scoring";
import { archetypeFor, requiredDomains, type ArchetypeInfo, type Content, type SkillInfo } from "./content";

export type SkillStatus = "locked" | "ready" | "learned" | "working" | "interview_ready";

export const LEVEL_NAMES = ["Unseen", "Familiar", "Working", "Interview-ready"] as const;

/** Learn unlocks when every direct prerequisite is at least Familiar (§19.5). */
export function learnUnlocked(skill: SkillInfo, states: Map<string, SkillState>): boolean {
  return skill.prereqIds.every((p) => (states.get(p)?.level ?? 0) >= 1);
}

/** Practice unlocks when every direct prerequisite is at least Working (§10.3). */
export function practiceUnlocked(skill: SkillInfo, states: Map<string, SkillState>): boolean {
  return skill.prereqIds.every((p) => (states.get(p)?.level ?? 0) >= 2);
}

export function skillStatus(skill: SkillInfo, states: Map<string, SkillState>): SkillStatus {
  const level = states.get(skill.id)?.level ?? 0;
  if (level === 3) return "interview_ready";
  if (level === 2) return "working";
  if (level === 1) return "learned";
  return learnUnlocked(skill, states) ? "ready" : "locked";
}

export type SkillView = {
  id: string;
  name: string;
  domainId: string;
  tier: number;
  level: number;
  levelName: string;
  status: SkillStatus;
  retention: number | null;
  fading: boolean;
  theta: number | null;
  coldStreak: number;
  attempts: number;
  required: boolean;
  requiredBand: number | null;
  score: number | null;
  prereqIds: string[];
  dependentIds: string[];
  practiceUnlocked: boolean;
  hasLesson: boolean;
  lessonMinutes: number;
  /** short right-hand detail: "r 0.97", "2 of 3 cold-correct", "lesson read", "needs X" */
  detail: string;
};

export function skillView(content: Content, skill: SkillInfo, states: Map<string, SkillState>, arch: ArchetypeInfo, now: Date, scores?: Record<string, number>): SkillView {
  const st = states.get(skill.id);
  const r = st ? retention(st, now) : null;
  const status = skillStatus(skill, states);
  const level = st?.level ?? 0;
  let detail = "";
  if (status === "locked") {
    const missing = skill.prereqIds.filter((p) => (states.get(p)?.level ?? 0) < 1).map((p) => content.skills.get(p)?.name ?? p);
    detail = `needs ${missing[0] ?? "prerequisites"}`;
  } else if (level === 3) detail = r !== null ? `r ${r.toFixed(2)}` : "";
  else if (level === 2) detail = `${Math.min(st?.coldStreak ?? 0, LEVEL3_STREAK)} of ${LEVEL3_STREAK} cold-correct`;
  else if (level === 1) detail = (st?.attempts ?? 0) > 0 ? "practising" : "lesson read";
  else detail = content.lessons.has(skill.id) ? `lesson · ${content.lessons.get(skill.id)!.est_minutes} min` : "ready to practise";
  return {
    id: skill.id,
    name: skill.name,
    domainId: skill.domainId,
    tier: skill.tier,
    level,
    levelName: LEVEL_NAMES[level]!,
    status,
    retention: r,
    fading: r !== null && r < REVIEW_THRESHOLD,
    theta: st ? st.theta : null,
    coldStreak: st?.coldStreak ?? 0,
    attempts: st?.attempts ?? 0,
    required: arch.required[skill.id] !== undefined,
    requiredBand: arch.required[skill.id] ?? null,
    score: scores?.[skill.id] ?? null,
    prereqIds: skill.prereqIds,
    dependentIds: skill.dependentIds,
    practiceUnlocked: practiceUnlocked(skill, states),
    hasLesson: content.lessons.has(skill.id),
    lessonMinutes: content.lessons.get(skill.id)?.est_minutes ?? skill.lessonMinutes,
    detail,
  };
}

export type ReadinessView = ReadinessResult & {
  archetypeId: string;
  archetypeName: string;
  domainRows: { id: string; name: string; short: string; score: number; target: number; weight: number; attempts: number }[];
  weakest: { id: string; name: string; score: number } | null;
};

export function readinessView(content: Content, states: Map<string, SkillState>, archetypeId: string | null, now: Date): ReadinessView {
  const arch = archetypeFor(content, archetypeId);
  const skills = content.skillList.filter((k) => content.domainById.get(k.domainId)?.live);
  const result = readiness(states, skills, arch, now);
  const doms = requiredDomains(content, arch);
  const domainRows = doms.map((d) => {
    const ds = result.domains.find((x) => x.domainId === d.id);
    return { id: d.id, name: d.name, short: d.short, score: Math.round(ds?.score ?? 0), target: DOMAIN_TARGET, weight: arch.weights[d.id] ?? 0, attempts: ds?.attempts ?? 0 };
  });
  const w = result.weakestDomain ? domainRows.find((d) => d.id === result.weakestDomain) : undefined;
  return {
    ...result,
    archetypeId: arch.id,
    archetypeName: arch.name,
    domainRows,
    weakest: w ? { id: w.id, name: w.name, score: w.score } : null,
  };
}

export function statusCounts(content: Content, states: Map<string, SkillState>, now: Date): Record<string, number> {
  const counts: Record<string, number> = { locked: 0, ready: 0, learned: 0, working: 0, interview_ready: 0, fading: 0 };
  for (const k of content.skillList) {
    if (!content.domainById.get(k.domainId)?.live) continue;
    counts[skillStatus(k, states)]!++;
    const st = states.get(k.id);
    const r = st ? retention(st, now) : null;
    if (r !== null && r < REVIEW_THRESHOLD) counts.fading!++;
  }
  return counts;
}
