import { INFERRED_PENALTY, SKIP_PRIOR_THETA } from "./constants";
import { initialSkillState } from "./model";
import type { SkillMeta, SkillState } from "./types";

/**
 * §7.2 — after placement, every required skill without direct evidence gets the
 * mean θ of attempted skills in its domain, minus a penalty, flagged inferred.
 * Returns only the states that changed.
 */
export function seedInferred(
  states: ReadonlyMap<string, SkillState>,
  skills: SkillMeta[],
  requiredIds: Iterable<string>,
): Map<string, SkillState> {
  const required = new Set(requiredIds);
  const byDomain = new Map<string, number[]>();
  for (const s of skills) {
    const st = states.get(s.id);
    if (st && st.attempts > 0 && !st.inferred) {
      const list = byDomain.get(s.domainId) ?? [];
      list.push(st.theta);
      byDomain.set(s.domainId, list);
    }
  }
  const out = new Map<string, SkillState>();
  for (const s of skills) {
    if (!required.has(s.id)) continue;
    const st = states.get(s.id);
    if (st && st.attempts > 0) continue;
    const thetas = byDomain.get(s.domainId);
    const theta = thetas && thetas.length
      ? thetas.reduce((a, b) => a + b, 0) / thetas.length - INFERRED_PENALTY
      : SKIP_PRIOR_THETA;
    out.set(s.id, { ...(st ?? initialSkillState()), theta, inferred: true });
  }
  return out;
}
