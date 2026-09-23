import { applyLessonCompletion, applyResponse, initialSkillState, propagateToPrereq } from "./model";
import type { Outcome, SkillMeta, SkillState } from "./types";

export type StoredResponse = {
  skillId: string;
  outcome: Outcome;
  at: Date;
};

export type StoredEvent =
  | ({ kind: "response" } & StoredResponse)
  | { kind: "lesson_completed"; skillId: string; at: Date }
  | { kind: "seed"; skillId: string; theta: number; inferred: boolean; at: Date };

/**
 * Apply one response to a user's full state map: the answered skill, then its
 * direct prerequisites. The live submit path and replay both go through here,
 * which is what makes them the same computation.
 */
export function applyToUser(
  states: Map<string, SkillState>,
  skills: ReadonlyMap<string, SkillMeta>,
  response: StoredResponse,
): ReturnType<typeof applyResponse> {
  const before = states.get(response.skillId) ?? initialSkillState();
  const result = applyResponse(before, response.outcome, response.at);
  states.set(response.skillId, result.state);
  for (const prereqId of skills.get(response.skillId)?.prereqIds ?? []) {
    const prereq = states.get(prereqId) ?? initialSkillState();
    states.set(prereqId, propagateToPrereq(prereq, response.outcome, result.delta));
  }
  return result;
}

/**
 * Rebuild every skill state from the surviving event stream, in order.
 * Voided responses are simply absent from `events`.
 */
export function replay(
  events: StoredEvent[],
  skills: SkillMeta[],
  initial?: Map<string, SkillState>,
): Map<string, SkillState> {
  const meta = new Map(skills.map((s) => [s.id, s]));
  const states = new Map(initial ?? []);
  const ordered = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const e of ordered) {
    if (e.kind === "response") applyToUser(states, meta, e);
    else if (e.kind === "lesson_completed") {
      states.set(e.skillId, applyLessonCompletion(states.get(e.skillId) ?? initialSkillState()));
    } else {
      const s = states.get(e.skillId) ?? initialSkillState();
      states.set(e.skillId, { ...s, theta: e.theta, inferred: e.inferred });
    }
  }
  return states;
}

/** Single-skill replay, for callers that already filtered to one skill with no prerequisites involved. */
export function replaySkill(responses: Omit<StoredResponse, "skillId">[], initial?: SkillState): SkillState {
  let state = initial ?? initialSkillState();
  for (const r of [...responses].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    state = applyResponse(state, r.outcome, r.at).state;
  }
  return state;
}
