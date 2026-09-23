/**
 * Product spec §19.2 / AUTHORING.md — the learning-path schema, as authored in YAML.
 */

export type Widget = "random_walk" | "bayes_grid" | "sampling_explorer" | "kelly_growth";

export type LessonCheck =
  | {
      type: "numeric";
      stem: string;
      answer: string;
      tolerance?: { abs?: number; rel?: number };
      hints?: string[];
      solution: string;
    }
  | {
      type: "mcq";
      stem: string;
      answer_label: string;
      distractors: { label: string; misconception_id?: string; feedback?: string }[];
      hints?: string[];
      solution: string;
    };

type StepBase = { id: string; title?: string; addresses?: string[] };

export type LessonStep =
  | (StepBase & { type: "concept"; body: string })
  | (StepBase & { type: "interactive"; body: string; widget: Widget; config: Record<string, unknown> })
  | (StepBase & {
      type: "worked";
      problem: string;
      steps: {
        text: string;
        self_explain?: { prompt: string; options: { text: string; correct: boolean; feedback: string }[] };
      }[];
    })
  | (StepBase & {
      type: "faded";
      problem: string;
      steps: ({ text: string } | { blank: { prompt: string; answer: string; hints?: string[]; solution?: string } })[];
    })
  | (StepBase & { type: "check"; transfer?: boolean; check: LessonCheck })
  | (StepBase & {
      type: "trap";
      prompt: string;
      flawed_solution: string[];
      error_step: number;
      explanation: string;
    })
  | (StepBase & { type: "summary"; body: string });

export type Lesson = {
  skill_id: string;
  version: number;
  title: string;
  est_minutes: number;
  status?: "draft" | "in_review" | "live";
  key_results: string[];
  steps: LessonStep[];
};

export type LessonProgress = {
  viewed: Set<string>;
  /** check or faded-blank ids answered correctly, keyed `${stepId}` or `${stepId}#${blankIndex}` */
  solved: Set<string>;
  firstTry: Set<string>;
  attempted: Set<string>;
};

export function emptyProgress(): LessonProgress {
  return { viewed: new Set(), solved: new Set(), firstTry: new Set(), attempted: new Set() };
}

/** Every gradeable key in a lesson: checks, and each blank of a faded example. */
export function gradeableKeys(lesson: Lesson): string[] {
  const keys: string[] = [];
  for (const s of lesson.steps) {
    if (s.type === "check") keys.push(s.id);
    if (s.type === "faded") s.steps.forEach((st, i) => "blank" in st && keys.push(`${s.id}#${i}`));
  }
  return keys;
}

export function checkKeys(lesson: Lesson): string[] {
  return lesson.steps.filter((s) => s.type === "check").map((s) => s.id);
}
