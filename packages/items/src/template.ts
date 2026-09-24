/**
 * Product spec §8.2 — the item template schema, as authored in YAML.
 * Keys stay snake_case: this is the authored payload stored in
 * `item_templates.payload`, validated by packages/db on write.
 */

export type ItemType = "numeric" | "mcq" | "symbolic" | "multistep" | "drill";
export type TemplateStatus = "draft" | "in_review" | "live" | "retired";
export type Usage = "practice" | "lesson";

export type Param =
  | { name: string; type: "int"; min: number; max: number; step?: number }
  | { name: string; type: "float"; min: number; max: number; step: number }
  | { name: string; type: "choice"; values: number[]; labels?: string[] };

export type Derived = { name: string; expr: string };

export type Tolerance = {
  abs?: number;
  rel?: number;
  /** accept if |log10(submitted) − log10(answer)| ≤ log — Fermi items */
  log?: number;
};

export type NearMiss = { expr: string; misconception_id: string };

export type Distractor =
  | { expr: string; label?: never; misconception_id: string }
  | { label: string; expr?: never; misconception_id: string };

export type Checkpoint = {
  prompt: string;
  kind: "numeric" | "symbolic";
  answer?: string;
  answer_expr?: string;
  variables?: string[];
  tolerance?: Tolerance;
  near_miss?: NearMiss[];
};

export type DrillSpec = {
  count: number;
  total_sec: number;
  pass_fraction?: number;
  item: {
    params: Param[];
    constraints?: string[];
    derived?: Derived[];
    stem: string;
    answer: string;
    tolerance?: Tolerance;
    near_miss?: NearMiss[];
  };
};

type Base = {
  id: string;
  version: number;
  skill_id: string;
  band: 1 | 2 | 3 | 4 | 5;
  type: ItemType;
  status?: TemplateStatus;
  usage?: Usage;
  placement?: boolean;
  params?: Param[];
  constraints?: string[];
  derived?: Derived[];
  stem: string;
  time_limit_sec: number;
  solution_steps?: string[];
  /** LaTeX shown on the answer screen as "correct answer"; defaults to the formatted value */
  answer_display?: string;
  source?: string;
};

export type NumericTemplate = Base & {
  type: "numeric";
  answer: string;
  tolerance?: Tolerance;
  unit?: "none" | "percent" | "currency";
  near_miss?: NearMiss[];
};

export type McqTemplate = Base & {
  type: "mcq";
  answer?: string;
  answer_label?: string;
  distractors: Distractor[];
  display?: { format: "number" | "percent" | "fraction"; decimals?: number };
};

export type SymbolicTemplate = Base & {
  type: "symbolic";
  answer_expr: string;
  variables: string[];
  domain_hints?: { var: string; assume: string }[];
  equivalence?: "algebraic" | "numeric_probe";
  tests?: { accept?: string[]; reject?: string[] };
};

export type MultistepTemplate = Base & {
  type: "multistep";
  checkpoints: Checkpoint[];
};

export type DrillTemplate = Base & {
  type: "drill";
  drill: DrillSpec;
};

export type ItemTemplate =
  | NumericTemplate
  | McqTemplate
  | SymbolicTemplate
  | MultistepTemplate
  | DrillTemplate;

export const DEFAULT_TOLERANCE: Required<Pick<Tolerance, "abs" | "rel">> = { abs: 1e-9, rel: 1e-6 };
