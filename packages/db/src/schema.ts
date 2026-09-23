/**
 * Tech spec §5 and §19 — the data model. Identifiers are UUIDv7 (time-sortable),
 * timestamps are timestamptz, rates are double precision.
 *
 * `responses` is append-only: the only permitted update is setting `voided_at`
 * (enforced by a trigger in migrations/0001_integrity.sql).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "./uuid";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().$defaultFn(uuidv7);
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

// ── Users and auth (Auth.js adapter shapes) ─────────────────────────────────

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  emailVerified: ts("email_verified"),
  name: text("name"),
  image: text("image"),
  role: text("role").notNull().default("learner"), // learner | author | reviewer | admin
  timezone: text("timezone").notNull().default("Europe/London"),
  archetypeId: text("archetype_id"),
  interviewDate: date("interview_date", { mode: "string" }),
  /** reminders, weekly summary, outcome sharing, daily minutes (product spec §18.4) */
  prefs: jsonb("prefs").$type<UserPrefs>().notNull().default(sql`'{}'::jsonb`),
  /** new → goal → placement | lessons → done */
  onboarding: text("onboarding").notNull().default("new"),
  ageConfirmedAt: ts("age_confirmed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export type UserPrefs = {
  reviewReminders?: boolean;
  weeklySummary?: boolean;
  shareOutcomes?: boolean;
  dailyMinutes?: number;
  reducedMotion?: boolean;
};

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

/** Database-backed sessions so they can be revoked (tech spec §10). */
export const authSessions = pgTable("auth_sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: ts("expires").notNull(),
});

/** Magic-link tokens: 15 minutes, single use, stored hashed. */
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: ts("expires").notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ── Content: authored, versioned, low write volume ──────────────────────────

export const domains = pgTable("domains", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  short: text("short").notNull(),
  position: smallint("position").notNull(),
  live: boolean("live").notNull(),
  hubSkillId: text("hub_skill_id"),
});

export const skills = pgTable("skills", {
  id: text("id").primaryKey(),
  domainId: text("domain_id").notNull().references(() => domains.id),
  name: text("name").notNull(),
  /** the band at which Level 3 is granted */
  band: smallint("band").notNull(),
  importance: smallint("importance").notNull(),
  lessonMinutes: smallint("lesson_minutes").notNull(),
  /** depth within the domain (tech spec §19.11), computed at seed */
  tier: smallint("tier").notNull().default(0),
});

export const skillPrereqs = pgTable(
  "skill_prereqs",
  {
    skillId: text("skill_id").notNull().references(() => skills.id),
    prereqId: text("prereq_id").notNull().references(() => skills.id),
  },
  (t) => [primaryKey({ columns: [t.skillId, t.prereqId] })],
);

export const misconceptions = pgTable("misconceptions", {
  id: text("id").primaryKey(),
  skillId: text("skill_id").notNull().references(() => skills.id),
  label: text("label").notNull(),
  explanation: text("explanation").notNull(),
});

export const archetypes = pgTable("archetypes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  firms: text("firms"),
  selectable: boolean("selectable").notNull(),
  note: text("note"),
  weights: jsonb("weights").$type<Record<string, number>>().notNull(),
  requiredSkills: jsonb("required_skills").$type<Record<string, number>>().notNull(),
});

export const itemTemplates = pgTable(
  "item_templates",
  {
    id: text("id").notNull(),
    version: integer("version").notNull(),
    skillId: text("skill_id").notNull().references(() => skills.id),
    band: smallint("band").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(), // draft | in_review | live | retired
    usage: text("usage").notNull().default("practice"), // practice | lesson
    placement: boolean("placement").notNull().default(false),
    timeLimitSec: integer("time_limit_sec").notNull(),
    payload: jsonb("payload").notNull(),
    changeClass: text("change_class"), // cosmetic | substantive | corrective
    /** result of the 200-seed sweep at the time this version was stored */
    sweep: jsonb("sweep").$type<{ passed: boolean; serveable: boolean; issues: { severity: string; code: string; message: string }[]; distinctAnswers: number }>(),
    authorId: uuid("author_id"),
    reviewerId: uuid("reviewer_id"),
    reviewNote: text("review_note"),
    createdAt: ts("created_at").notNull().defaultNow(),
    reviewedAt: ts("reviewed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.version] }),
    index("item_templates_skill_idx").on(t.skillId, t.band).where(sql`usage = 'practice'`),
  ],
);

export const lessons = pgTable(
  "lessons",
  {
    skillId: text("skill_id").notNull().references(() => skills.id),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    estMinutes: smallint("est_minutes").notNull(),
    steps: jsonb("steps").notNull(),
    keyResults: jsonb("key_results").$type<string[]>().notNull(),
    status: text("status").notNull(),
    authorId: uuid("author_id"),
    reviewerId: uuid("reviewer_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.skillId, t.version] })],
);

/** Long-form lesson or primer shown on the skill page. */
export const readings = pgTable("readings", {
  skillId: text("skill_id").primaryKey().references(() => skills.id),
  kind: text("kind").notNull(),
  body: text("body").notNull(),
});

// ── User state: small, hot, read on every page ──────────────────────────────

export const userSkillState = pgTable(
  "user_skill_state",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull().references(() => skills.id),
    theta: doublePrecision("theta").notNull(),
    level: smallint("level").notNull().default(0),
    coldStreak: smallint("cold_streak").notNull().default(0),
    stabilityS: doublePrecision("stability_s").notNull(),
    lastCorrectAt: ts("last_correct_at"),
    dueAt: ts("due_at"),
    attempts: integer("attempts").notNull().default(0),
    levelAttempts: integer("level_attempts").notNull().default(0),
    inferred: boolean("inferred").notNull().default(false),
    lastPassedBand: smallint("last_passed_band"),
    recent: jsonb("recent").notNull().default(sql`'[]'::jsonb`),
    /** band practice starts at after the learning path (§19.4) */
    entryBand: smallint("entry_band"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.skillId] }),
    index("user_skill_state_due_idx").on(t.userId, t.dueAt).where(sql`due_at is not null`),
  ],
);

// ── Sessions and responses: the write path ──────────────────────────────────

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    mode: text("mode").notNull(), // practice | assessment | placement | review | drill
    startedAt: ts("started_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
    targetItems: integer("target_items").notNull(),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    /** frozen at session end: the summary screen replays from this */
    summary: jsonb("summary"),
    readinessBefore: integer("readiness_before"),
    readinessAfter: integer("readiness_after"),
  },
  (t) => [index("sessions_user_idx").on(t.userId, t.startedAt)],
);

export const sessionItems = pgTable(
  "session_items",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    kind: text("kind").notNull().default("item"), // item | lesson | refresher
    bucket: text("bucket"), // review | weakest | new | placement | assessment | lesson | refresher
    skillId: text("skill_id").notNull().references(() => skills.id),
    templateId: text("template_id"),
    templateVersion: integer("template_version"),
    seed: integer("seed"),
    instanceHash: text("instance_hash"),
    band: smallint("band"),
    /** planned | served | grading | answered | timed_out | ungraded | abandoned | skipped | done */
    status: text("status").notNull().default("planned"),
    servedAt: ts("served_at"),
    submittedAt: ts("submitted_at"),
    elapsedMs: integer("elapsed_ms"),
    predictedP: doublePrecision("predicted_p"),
    /** per-checkpoint / per-drill-item progress while the item is open */
    progress: jsonb("progress"),
    /** cached rendered result: a resubmit or refresh replays it without regrading */
    verdict: jsonb("verdict"),
  },
  (t) => [
    index("session_items_session_idx").on(t.sessionId, t.position),
    index("session_items_sweeper_idx").on(t.status, t.servedAt).where(sql`status in ('served','grading')`),
  ],
);

export const responses = pgTable(
  "responses",
  {
    id: id(),
    sessionItemId: uuid("session_item_id").notNull().references(() => sessionItems.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    skillId: text("skill_id").notNull(),
    templateId: text("template_id").notNull(),
    templateVersion: integer("template_version").notNull(),
    seed: integer("seed").notNull(),
    instanceHash: text("instance_hash").notNull(),
    band: smallint("band").notNull(),
    type: text("type").notNull(),
    submittedRaw: text("submitted_raw"),
    y: doublePrecision("y").notNull(),
    correct: boolean("correct").notNull(),
    timedOut: boolean("timed_out").notNull(),
    withinLimit: boolean("within_limit").notNull(),
    seenBefore: boolean("seen_before").notNull(),
    elapsedMs: integer("elapsed_ms").notNull(),
    clientElapsedMs: integer("client_elapsed_ms"),
    timingFlag: boolean("timing_flag").notNull().default(false),
    pPred: doublePrecision("p_pred").notNull(),
    thetaBefore: doublePrecision("theta_before").notNull(),
    thetaAfter: doublePrecision("theta_after").notNull(),
    bBefore: doublePrecision("b_before").notNull(),
    bAfter: doublePrecision("b_after").notNull(),
    levelBefore: smallint("level_before").notNull(),
    levelAfter: smallint("level_after").notNull(),
    itemResponseCount: integer("item_response_count").notNull(),
    setSize: integer("set_size"),
    misconceptionId: text("misconception_id"),
    mode: text("mode").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    voidedAt: ts("voided_at"),
  },
  (t) => [
    index("responses_user_skill_idx").on(t.userId, t.skillId, t.createdAt).where(sql`voided_at is null`),
    index("responses_seen_idx").on(t.userId, t.templateId, t.instanceHash),
    index("responses_template_idx").on(t.templateId, t.templateVersion, t.createdAt),
  ],
);

export const itemStats = pgTable(
  "item_stats",
  {
    templateId: text("template_id").notNull(),
    version: integer("version").notNull(),
    responses: integer("responses").notNull().default(0),
    correct: integer("correct").notNull().default(0),
    totalElapsedMs: doublePrecision("total_elapsed_ms").notNull().default(0),
    medianElapsedMs: integer("median_elapsed_ms"),
    discrimination: doublePrecision("discrimination"),
    flagCount: integer("flag_count").notNull().default(0),
    voidCount: integer("void_count").notNull().default(0),
    b: doublePrecision("b").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.version] })],
);

export const flags = pgTable("flags", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  targetType: text("target_type").notNull().default("item"), // item | lesson_step
  sessionItemId: uuid("session_item_id"),
  templateId: text("template_id"),
  version: integer("version"),
  seed: integer("seed"),
  lessonSkillId: text("lesson_skill_id"),
  lessonVersion: integer("lesson_version"),
  stepId: text("step_id"),
  note: text("note"),
  status: text("status").notNull().default("open"), // open | dismissed | edited | retired
  resolvedBy: uuid("resolved_by"),
  resolvedAt: ts("resolved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const outcomes = pgTable("outcomes", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  firm: text("firm"),
  stage: text("stage"),
  result: text("result"),
  readinessAtTime: integer("readiness_at_time"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ── Learning (tech spec §19) ────────────────────────────────────────────────

export const lessonProgress = pgTable(
  "lesson_progress",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull().references(() => skills.id),
    lessonVersion: integer("lesson_version").notNull(),
    status: text("status").notNull().default("in_progress"), // not_started | in_progress | completed | skipped
    currentStepId: text("current_step_id"),
    viewed: jsonb("viewed").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    solved: jsonb("solved").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    firstTry: jsonb("first_try").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    attempted: jsonb("attempted").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    hintsUsed: jsonb("hints_used").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    firstTryChecks: integer("first_try_checks").notNull().default(0),
    totalChecks: integer("total_checks").notNull().default(0),
    startedAt: ts("started_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.skillId] })],
);

export const lessonStepEvents = pgTable(
  "lesson_step_events",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    skillId: text("skill_id").notNull(),
    lessonVersion: integer("lesson_version").notNull(),
    stepId: text("step_id").notNull(),
    event: text("event").notNull(), // viewed | check_attempt | hint | reveal
    payload: jsonb("payload"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("lesson_step_events_skill_idx").on(t.skillId, t.lessonVersion, t.stepId)],
);

export const remediation = pgTable(
  "remediation",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull(),
    cause: text("cause").notNull(), // failure_rate | repeat_misconception | demotion
    misconceptionId: text("misconception_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    resolvedAt: ts("resolved_at"),
    resolution: text("resolution"), // completed | skipped
  },
  (t) => [index("remediation_open_idx").on(t.userId).where(sql`resolved_at is null`)],
);

export const readinessSnapshots = pgTable(
  "readiness_snapshots",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    readiness: integer("readiness"),
    rawReadiness: integer("raw_readiness").notNull(),
    provisional: boolean("provisional").notNull(),
    validated: boolean("validated").notNull(),
    domainScores: jsonb("domain_scores").$type<Record<string, number>>().notNull(),
    statusCounts: jsonb("status_counts").$type<Record<string, number>>().notNull(),
    event: text("event"), // null for nightly; placement | assessment
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);

// ── Operations ──────────────────────────────────────────────────────────────

/** Tech spec §11 Option A: server-side events, queried with SQL. */
export const events = pgTable(
  "events",
  {
    id: id(),
    name: text("name").notNull(),
    userId: uuid("user_id"),
    props: jsonb("props").notNull().default(sql`'{}'::jsonb`),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("events_name_idx").on(t.name, t.createdAt)],
);

/** Tech spec §10 Option A: fixed-window counters in Postgres. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/** CSV exports: a signed, expiring link (tech spec §10). Stored in Postgres locally; S3 in AWS. */
export const exports = pgTable("exports", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  body: bytea("body"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
