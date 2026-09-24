/**
 * Tech spec §10 — rate limits. Option A: fixed-window counters in Postgres.
 * Option B: Valkey, behind the same interface.
 */
import { sql } from "drizzle-orm";
import { getDb, schema as s } from "@qa/db";
import { AppError } from "./errors";

export const LIMITS = {
  answer: { limit: 60, windowSec: 60 },
  session: { limit: 10, windowSec: 3600 },
  flag: { limit: 5, windowSec: 3600 },
  auth: { limit: 10, windowSec: 3600 },
  export: { limit: 3, windowSec: 86400 },
  admin: { limit: 300, windowSec: 3600 },
} as const;
export type LimitName = keyof typeof LIMITS;

export interface RateLimiter {
  hit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; count: number }>;
}

export class PostgresRateLimiter implements RateLimiter {
  async hit(key: string, limit: number, windowSec: number) {
    const windowStart = new Date(Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000);
    const [row] = await getDb()
      .insert(s.rateLimits)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({ target: [s.rateLimits.key, s.rateLimits.windowStart], set: { count: sql`${s.rateLimits.count} + 1` } })
      .returning({ count: s.rateLimits.count });
    return { allowed: (row?.count ?? 1) <= limit, count: row?.count ?? 1 };
  }
}

let limiter: RateLimiter = new PostgresRateLimiter();
export function useRateLimiter(next: RateLimiter) {
  limiter = next;
}

export async function rateLimit(name: LimitName, subject: string): Promise<void> {
  if (process.env.RATE_LIMITS === "off") return;
  const { limit, windowSec } = LIMITS[name];
  const { allowed } = await limiter.hit(`${name}:${subject}`, limit, windowSec);
  if (!allowed) throw new AppError("RATE_LIMITED", `${name} limit reached`);
}
