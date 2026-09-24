/**
 * Tech spec §8 — one error shape everywhere: { error: { code, message, field? } }.
 * The UI maps codes to the copy in the Figma edge-states frame; it never shows `message`.
 */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "NOT_A_NUMBER"
  | "PARSE_ERROR"
  | "ITEM_ALREADY_ANSWERED"
  | "ITEM_GRADING"
  | "ITEM_NOT_OPEN"
  | "GRADER_UNAVAILABLE"
  | "PREREQ_NOT_MET"
  | "RATE_LIMITED"
  | "SESSION_ENDED"
  | "ASSESSMENT_LOCKED"
  | "EMPTY_QUEUE"
  | "LESSON_INCOMPLETE"
  | "CONFLICT";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  NOT_A_NUMBER: 422,
  PARSE_ERROR: 422,
  ITEM_ALREADY_ANSWERED: 409,
  ITEM_GRADING: 409,
  ITEM_NOT_OPEN: 409,
  GRADER_UNAVAILABLE: 503,
  PREREQ_NOT_MET: 403,
  RATE_LIMITED: 429,
  SESSION_ENDED: 409,
  ASSESSMENT_LOCKED: 403,
  EMPTY_QUEUE: 409,
  LESSON_INCOMPLETE: 409,
  CONFLICT: 409,
};

export class AppError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message?: string, readonly field?: string) {
    super(message ?? code);
    this.name = "AppError";
    this.status = STATUS[code];
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, ...(this.field ? { field: this.field } : {}) } };
  }
}
