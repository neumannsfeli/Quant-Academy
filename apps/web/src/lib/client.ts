"use client";

export type ApiError = { code: string; message: string; field?: string };

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly error: ApiError) {
    super(error.message);
  }
}

/** Client fetch helper. The server's error codes map to fixed copy (edge-states frame), never raw messages. */
export async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    method: rest.method ?? (json !== undefined ? "POST" : "GET"),
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiFailure(res.status, (data as { error?: ApiError }).error ?? { code: "NETWORK", message: res.statusText });
  return data as T;
}

export const ERROR_COPY: Record<string, string> = {
  NOT_A_NUMBER: "That isn’t a number we can read — check for a typo. Nothing was submitted.",
  PARSE_ERROR: "That isn’t an expression we can read — check the brackets and operators. Nothing was submitted.",
  VALIDATION: "Check that and try again.",
  ITEM_GRADING: "Still grading — one moment.",
  RATE_LIMITED: "That’s a lot of requests in a short time. Give it a minute.",
  UNAUTHENTICATED: "Your session has ended. Sign in again to continue.",
  GRADER_UNAVAILABLE: "We couldn’t check that just now. Try again in a moment.",
  LESSON_INCOMPLETE: "Finish every step and check first.",
  ASSESSMENT_LOCKED: "The assessment isn’t open yet.",
  EMPTY_QUEUE: "Nothing to practise right now.",
  NETWORK: "We couldn’t reach the server. Your answer is kept here — we’ll retry.",
  INTERNAL: "Something went wrong on our side. Try again.",
};

export function copyFor(e: unknown): string {
  if (e instanceof ApiFailure) return ERROR_COPY[e.error.code] ?? ERROR_COPY.INTERNAL!;
  return ERROR_COPY.NETWORK!;
}
