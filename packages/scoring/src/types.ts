import type { Band, Level } from "./constants";

export type { Band, Level };

export type Mode = "practice" | "assessment" | "placement";

/** One entry of the per-skill history that level rules read (§5). Placement never appears here. */
export type RecentOutcome = {
  correct: boolean;
  band: Band;
  /** counted toward the Level 3 cold streak */
  cold: boolean;
  misconceptionId: string | null;
  at: number; // epoch ms
};

export type SkillState = {
  theta: number;
  level: Level;
  coldStreak: number;
  stabilityS: number;
  lastCorrectAt: Date | null;
  /** every scored attempt, placement included — drives Kᵤ and the provisional thresholds */
  attempts: number;
  /** scored attempts outside placement — drives the Working criterion */
  levelAttempts: number;
  inferred: boolean;
  /** band at which the skill was last passed; reviews are served here (§10.2) */
  lastPassedBand: Band | null;
  /** most recent first, capped at RECENT_CAP */
  recent: RecentOutcome[];
};

export type Outcome = {
  /** 1, 0, or fractional for multi-step / drill (§8.1.1, §8.1.2) */
  y: number;
  /** full correctness: every checkpoint unaided, or drill k/N ≥ pass fraction */
  correct: boolean;
  band: Band;
  /** item difficulty at time of answer */
  b: number;
  timedOut: boolean;
  withinLimit: boolean;
  seenBefore: boolean;
  /** responses the template had before this one — drives c and Kᵢ */
  itemResponseCount: number;
  /** drills only */
  setSize?: number;
  mode: Mode;
  misconceptionId?: string | null;
};

export type Delta = {
  p: number;
  ku: number;
  c: number;
  thetaBefore: number;
  thetaAfter: number;
  bBefore: number;
  bAfter: number;
  levelBefore: Level;
  levelAfter: Level;
  coldStreakBefore: number;
  coldStreakAfter: number;
  stabilityBefore: number;
  stabilityAfter: number;
};

export type SkillMeta = {
  id: string;
  domainId: string;
  importance: 1 | 2 | 3;
  prereqIds: string[];
};

export type Archetype = {
  id: string;
  /** domain id → weight; sums to 1 */
  weights: Record<string, number>;
  /** skill id → band required for this profile */
  required: Record<string, Band>;
};

export type DomainScore = {
  domainId: string;
  weight: number;
  score: number;
  attempts: number;
};

export type ReadinessResult = {
  /** null while provisional (§6.5) */
  score: number | null;
  /** the number that would be shown, for internal use and snapshots */
  rawScore: number;
  mean: number;
  powerMean: number;
  domains: DomainScore[];
  weakestDomain: string | null;
  provisional: boolean;
  provisionalReason?: string;
  totalAttempts: number;
  skillScores: Record<string, number>;
};
