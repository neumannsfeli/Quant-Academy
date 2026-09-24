import {
  BAND_PRIORS,
  FRESHNESS_FLOOR,
  LEVEL_CAPS,
  PROVISIONAL_MIN_ATTEMPTS,
  PROVISIONAL_MIN_PER_DOMAIN,
  READINESS_MEAN_WEIGHT,
  READINESS_POWER_P,
  READINESS_POWER_WEIGHT,
  SKILL_SCORE_SLOPE,
  SKIP_PRIOR_THETA,
} from "./constants";
import { retention, sigmoid } from "./model";
import type { Archetype, Band, DomainScore, ReadinessResult, SkillMeta, SkillState } from "./types";

/** §6.1 — one required skill's score, 0–100. */
export function skillScore(state: SkillState | undefined, requiredBand: Band, now: Date): number {
  const theta = state?.theta ?? SKIP_PRIOR_THETA;
  let c = 100 * sigmoid(SKILL_SCORE_SLOPE * (theta - BAND_PRIORS[requiredBand]));
  // No successful recall yet means no evidence of retention: take the floor.
  const r = state ? (retention(state, now) ?? 0) : 0;
  c *= FRESHNESS_FLOOR + (1 - FRESHNESS_FLOOR) * r;
  return Math.min(c, LEVEL_CAPS[state?.level ?? 0]);
}

/** §6.3 — weighted power mean with exponent p < 0. */
export function powerMean(values: { weight: number; value: number }[], p: number): number {
  const total = values.reduce((s, v) => s + v.weight, 0);
  if (total <= 0) return 0;
  let acc = 0;
  for (const { weight, value } of values) {
    // A domain at exactly zero drives the mean to zero; keep it finite.
    acc += (weight / total) * Math.pow(Math.max(value, 1e-9), p);
  }
  return Math.pow(acc, 1 / p);
}

/** §6.3 — blend a weighted arithmetic mean with the min-seeking power mean. */
export function blendReadiness(domains: { weight: number; value: number }[]): {
  mean: number;
  power: number;
  raw: number;
} {
  const total = domains.reduce((s, d) => s + d.weight, 0);
  const mean = total > 0 ? domains.reduce((s, d) => s + d.weight * d.value, 0) / total : 0;
  const power = powerMean(domains, READINESS_POWER_P);
  return { mean, power, raw: READINESS_MEAN_WEIGHT * mean + READINESS_POWER_WEIGHT * power };
}

/**
 * §6 — readiness, computed on read from the user's skill states.
 * `states` may omit skills the user has never touched.
 */
export function readiness(
  states: ReadonlyMap<string, SkillState> | Record<string, SkillState>,
  skills: SkillMeta[],
  archetype: Archetype,
  now: Date,
): ReadinessResult {
  const get = (id: string): SkillState | undefined =>
    states instanceof Map ? states.get(id) : (states as Record<string, SkillState>)[id];

  const byDomain = new Map<string, SkillMeta[]>();
  for (const s of skills) {
    if (archetype.required[s.id] === undefined) continue;
    const list = byDomain.get(s.domainId) ?? [];
    list.push(s);
    byDomain.set(s.domainId, list);
  }

  const skillScores: Record<string, number> = {};
  const domains: DomainScore[] = [];
  for (const [domainId, weight] of Object.entries(archetype.weights)) {
    if (weight <= 0) continue;
    const required = byDomain.get(domainId) ?? [];
    let num = 0;
    let den = 0;
    for (const s of required) {
      const c = skillScore(get(s.id), archetype.required[s.id]!, now);
      skillScores[s.id] = c;
      num += s.importance * c;
      den += s.importance;
    }
    const attempts = skills
      .filter((s) => s.domainId === domainId)
      .reduce((n, s) => n + (get(s.id)?.attempts ?? 0), 0);
    domains.push({ domainId, weight, score: den > 0 ? num / den : 0, attempts });
  }

  const { mean, power, raw } = blendReadiness(domains.map((d) => ({ weight: d.weight, value: d.score })));
  const totalAttempts = skills.reduce((n, s) => n + (get(s.id)?.attempts ?? 0), 0);

  let weakest: DomainScore | null = null;
  for (const d of domains) {
    if (!weakest || d.score < weakest.score || (d.score === weakest.score && d.weight > weakest.weight)) {
      weakest = d;
    }
  }

  let provisionalReason: string | undefined;
  if (totalAttempts < PROVISIONAL_MIN_ATTEMPTS) {
    provisionalReason = `${totalAttempts} of ${PROVISIONAL_MIN_ATTEMPTS} scored attempts`;
  } else {
    const thin = domains.filter((d) => d.attempts < PROVISIONAL_MIN_PER_DOMAIN);
    if (thin.length) {
      provisionalReason = `fewer than ${PROVISIONAL_MIN_PER_DOMAIN} attempts in ${thin.map((d) => d.domainId).join(", ")}`;
    }
  }
  const provisional = provisionalReason !== undefined;
  const rawScore = Math.round(raw);

  return {
    score: provisional ? null : rawScore,
    rawScore,
    mean,
    powerMean: power,
    domains,
    weakestDomain: weakest?.domainId ?? null,
    provisional,
    ...(provisionalReason ? { provisionalReason } : {}),
    totalAttempts,
    skillScores,
  };
}
