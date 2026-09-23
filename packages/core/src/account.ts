/**
 * Settings, onboarding, export and deletion (tech spec §8, §10; product spec §18).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb, schema as s, type UserPrefs } from "@qa/db";
import { z } from "zod";
import { SESSION_DEFAULT_MINUTES } from "@qa/scoring";
import { config } from "./config";
import { getContent } from "./content";
import { AppError } from "./errors";
import { events } from "./events";
import { sendMail, templates } from "./mail";
import { rateLimit } from "./ratelimit";

export const DEFAULT_PREFS: Required<Omit<UserPrefs, "reducedMotion">> = {
  reviewReminders: true, // service message the user asked for by using the product (§18.4)
  weeklySummary: false,
  shareOutcomes: false, // consent: never pre-ticked
  dailyMinutes: SESSION_DEFAULT_MINUTES,
};

export async function getMe(userId: string) {
  const [u] = await getDb().select().from(s.users).where(eq(s.users.id, userId));
  if (!u || u.deletedAt) throw new AppError("UNAUTHENTICATED");
  const content = await getContent();
  const accounts = await getDb().select({ provider: s.accounts.provider }).from(s.accounts).where(eq(s.accounts.userId, userId));
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    timezone: u.timezone,
    archetypeId: u.archetypeId,
    interviewDate: u.interviewDate,
    onboarding: u.onboarding,
    ageConfirmedAt: u.ageConfirmedAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    prefs: { ...DEFAULT_PREFS, ...u.prefs },
    signInMethods: ["email", ...accounts.map((a) => a.provider)],
    archetypes: [...content.archetypes.values()].map((a) => ({ id: a.id, name: a.name, firms: a.firms, selectable: a.selectable, note: a.note, weights: a.weights })),
  };
}

const patchSchema = z
  .object({
    name: z.string().max(80).nullable().optional(),
    timezone: z.string().max(64).optional(),
    archetypeId: z.string().optional(),
    interviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    prefs: z
      .object({
        reviewReminders: z.boolean().optional(),
        weeklySummary: z.boolean().optional(),
        shareOutcomes: z.boolean().optional(),
        dailyMinutes: z.number().int().min(10).max(90).optional(),
        reducedMotion: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export async function updateMe(userId: string, body: unknown) {
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new AppError("VALIDATION", issue.message, issue.path.join("."));
  }
  const patch = parsed.data;
  const db = getDb();
  const [u] = await db.select().from(s.users).where(eq(s.users.id, userId));
  if (!u) throw new AppError("UNAUTHENTICATED");
  if (patch.archetypeId) {
    const a = (await getContent()).archetypes.get(patch.archetypeId);
    if (!a || !a.selectable) throw new AppError("VALIDATION", "that profile is not available yet", "archetypeId");
  }
  if (patch.timezone) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: patch.timezone });
    } catch {
      throw new AppError("VALIDATION", "unknown timezone", "timezone");
    }
  }
  const set: Partial<typeof s.users.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.timezone) set.timezone = patch.timezone;
  if (patch.archetypeId) set.archetypeId = patch.archetypeId;
  if (patch.interviewDate !== undefined) set.interviewDate = patch.interviewDate;
  if (patch.prefs) set.prefs = { ...u.prefs, ...patch.prefs };
  if (Object.keys(set).length) await db.update(s.users).set(set).where(eq(s.users.id, userId));
  if (patch.archetypeId && patch.archetypeId !== u.archetypeId) await events.emit("archetype_selected", userId, { archetype: patch.archetypeId });
  // An interview date changes every due_at: recompute them (§4.4).
  if (patch.interviewDate !== undefined) await recomputeDueDates(userId);
  return getMe(userId);
}

async function recomputeDueDates(userId: string) {
  const { loadStates, saveState, interviewDateOf } = await import("./states");
  const db = getDb();
  const [u] = await db.select().from(s.users).where(eq(s.users.id, userId));
  const states = await loadStates(db, userId);
  const now = new Date();
  for (const [skillId, st] of states) await saveState(db, userId, skillId, st, now, interviewDateOf(u!));
}

const goalSchema = z.object({
  archetypeId: z.string(),
  interviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  ageConfirmed: z.literal(true, { errorMap: () => ({ message: "you must be 16 or over to use Quant Academy" }) }),
  start: z.enum(["placement", "lessons", "skip"]),
  timezone: z.string().optional(),
});

/** Onboarding step 1–2 (frame 01): goal, optional interview date, age, and how to start (§19.7). */
export async function setGoal(userId: string, body: unknown) {
  const parsed = goalSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new AppError("VALIDATION", issue.message, issue.path.join("."));
  }
  const g = parsed.data;
  const content = await getContent();
  const a = content.archetypes.get(g.archetypeId);
  if (!a || !a.selectable) throw new AppError("VALIDATION", "that profile is not available yet", "archetypeId");
  await getDb()
    .update(s.users)
    .set({
      archetypeId: g.archetypeId,
      interviewDate: g.interviewDate ?? null,
      ageConfirmedAt: new Date(),
      onboarding: g.start === "placement" ? "placement" : "done",
      ...(g.timezone ? { timezone: g.timezone } : {}),
    })
    .where(eq(s.users.id, userId));
  await events.emit("archetype_selected", userId, { archetype: g.archetypeId });
  if (g.start === "skip") await events.emit("placement_skipped", userId, { at_item: 0 });
  return { next: g.start };
}

// ── Export (tech spec §10: a link that expires in one hour, not an attachment) ──

export async function requestExport(userId: string) {
  await rateLimit("export", userId);
  const db = getDb();
  const [u] = await db.select().from(s.users).where(eq(s.users.id, userId));
  if (!u) throw new AppError("UNAUTHENTICATED");
  const rows = await db.select().from(s.responses).where(eq(s.responses.userId, userId)).orderBy(s.responses.createdAt);
  const header = ["created_at", "session_id", "skill_id", "template_id", "template_version", "seed", "band", "type", "submitted", "correct", "timed_out", "elapsed_ms", "p_pred", "theta_before", "theta_after", "misconception_id", "mode", "voided_at"];
  const cell = (v: unknown) => {
    const t = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = [header.join(","), ...rows.map((r) => [r.createdAt, r.sessionId, r.skillId, r.templateId, r.templateVersion, r.seed, r.band, r.type, r.submittedRaw, r.correct, r.timedOut, r.elapsedMs, r.pPred.toFixed(4), r.thetaBefore.toFixed(4), r.thetaAfter.toFixed(4), r.misconceptionId, r.mode, r.voidedAt].map(cell).join(","))].join("\n");
  const token = randomBytes(24).toString("base64url");
  const [row] = await db
    .insert(s.exports)
    .values({ userId, tokenHash: createHash("sha256").update(token).digest("hex"), body: Buffer.from(csv), expiresAt: new Date(Date.now() + 3600_000) })
    .returning({ id: s.exports.id });
  const url = `${config.appUrl}/api/me/export/${row!.id}?token=${token}`;
  await sendMail(u.email, templates.exportReady(url));
  return { ok: true, rows: rows.length };
}

export async function downloadExport(exportId: string, token: string) {
  const [row] = await getDb()
    .select()
    .from(s.exports)
    .where(and(eq(s.exports.id, exportId), gt(s.exports.expiresAt, new Date())));
  if (!row || row.tokenHash !== createHash("sha256").update(token).digest("hex")) throw new AppError("NOT_FOUND", "this link has expired");
  return row.body!;
}

/**
 * Tech spec §5 — hard-delete everything identifying; keep responses with
 * user_id set to null, because every other user's item calibration depends on them.
 */
export async function deleteAccount(userId: string, confirmEmail: string) {
  const db = getDb();
  const [u] = await db.select().from(s.users).where(eq(s.users.id, userId));
  if (!u) throw new AppError("UNAUTHENTICATED");
  if (confirmEmail.trim().toLowerCase() !== u.email.toLowerCase()) throw new AppError("VALIDATION", "type your email address to confirm", "confirm");
  await db.transaction(async (tx) => {
    await tx.update(s.responses).set({ userId: null }).where(eq(s.responses.userId, userId));
    await tx.update(s.events).set({ userId: null, props: sql`${s.events.props} - 'email'` }).where(eq(s.events.userId, userId));
    await tx.update(s.lessonStepEvents).set({ userId: null }).where(eq(s.lessonStepEvents.userId, userId));
    await tx.delete(s.verificationTokens).where(eq(s.verificationTokens.identifier, u.email));
    await tx.delete(s.users).where(eq(s.users.id, userId)); // cascades state, sessions-of-auth, progress, exports
  });
  await events.emit("account_deleted", null, {});
  return { ok: true };
}

const outcomeSchema = z.object({ firm: z.string().max(80).nullable().optional(), stage: z.string().max(40).nullable().optional(), result: z.enum(["offer", "rejected", "next_round", "withdrew", "waiting"]) });

export async function reportOutcome(userId: string, body: unknown, readiness: number | null) {
  const parsed = outcomeSchema.safeParse(body);
  if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0]!.message);
  await getDb().insert(s.outcomes).values({ userId, firm: parsed.data.firm ?? null, stage: parsed.data.stage ?? null, result: parsed.data.result, readinessAtTime: readiness });
  await events.emit("outcome_reported", userId, { ...parsed.data, readiness_at_time: readiness });
  return { ok: true };
}

/** Mobile landing (frame 08): one email, then the address is gone (§18.4). */
export async function desktopHandoff(email: string, ip: string) {
  await rateLimit("auth", ip);
  if (!z.string().email().safeParse(email).success) throw new AppError("VALIDATION", "enter a valid email address", "email");
  await sendMail(email, templates.desktopHandoff());
  return { ok: true };
}
