/**
 * Tech spec §16.3 item 3: the grader behind an interface, selected by environment.
 * HttpGrader serves local, preview and Option B; a LambdaInvokeGrader for Option A
 * implements the same interface in infra.
 */
import { config } from "./config";

export type GradeRequest = {
  submitted: string;
  answer: string;
  variables: string[];
  assumptions: Record<string, string>;
  equivalence?: "algebraic" | "numeric_probe";
};

export type GradeResult =
  | { status: "graded"; correct: boolean; method: string; normalised: string; graderVersion: string }
  | { status: "parse_error"; message: string }
  | { status: "unavailable"; reason: string };

export interface GraderClient {
  grade(req: GradeRequest): Promise<GradeResult>;
}

export class HttpGrader implements GraderClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 2000) {}

  async grade(req: GradeRequest): Promise<GradeResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/grade`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "symbolic", probePoints: 20, ...req }),
        signal: ctrl.signal,
      });
      if (res.status === 422) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return { status: "parse_error", message: body.error?.message ?? "not a valid expression" };
      }
      if (!res.ok) return { status: "unavailable", reason: `http ${res.status}` };
      const body = (await res.json()) as { correct: boolean; method: string; normalised: string; graderVersion: string };
      return { status: "graded", ...body };
    } catch (e) {
      return { status: "unavailable", reason: (e as Error).name === "AbortError" ? "timeout" : (e as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Used when no grader is configured: every symbolic item is voided, never marked wrong. */
export class UnavailableGrader implements GraderClient {
  async grade(): Promise<GradeResult> {
    return { status: "unavailable", reason: "no grader configured" };
  }
}

let override: GraderClient | null = null;
export function setGrader(g: GraderClient | null) {
  override = g;
}
export function getGrader(): GraderClient {
  if (override) return override;
  return config.graderUrl ? new HttpGrader(config.graderUrl, config.graderTimeoutMs) : new UnavailableGrader();
}
