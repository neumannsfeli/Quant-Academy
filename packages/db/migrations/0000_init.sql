CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "archetypes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"firms" text,
	"selectable" boolean NOT NULL,
	"note" text,
	"weights" jsonb NOT NULL,
	"required_skills" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short" text NOT NULL,
	"position" smallint NOT NULL,
	"live" boolean NOT NULL,
	"hub_skill_id" text
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"body" "bytea",
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"target_type" text DEFAULT 'item' NOT NULL,
	"session_item_id" uuid,
	"template_id" text,
	"version" integer,
	"seed" integer,
	"lesson_skill_id" text,
	"lesson_version" integer,
	"step_id" text,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_stats" (
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"responses" integer DEFAULT 0 NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"total_elapsed_ms" double precision DEFAULT 0 NOT NULL,
	"median_elapsed_ms" integer,
	"discrimination" double precision,
	"flag_count" integer DEFAULT 0 NOT NULL,
	"void_count" integer DEFAULT 0 NOT NULL,
	"b" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_stats_template_id_version_pk" PRIMARY KEY("template_id","version")
);
--> statement-breakpoint
CREATE TABLE "item_templates" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"skill_id" text NOT NULL,
	"band" smallint NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"usage" text DEFAULT 'practice' NOT NULL,
	"placement" boolean DEFAULT false NOT NULL,
	"time_limit_sec" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"change_class" text,
	"sweep" jsonb,
	"author_id" uuid,
	"reviewer_id" uuid,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "item_templates_id_version_pk" PRIMARY KEY("id","version")
);
--> statement-breakpoint
CREATE TABLE "lesson_progress" (
	"user_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"lesson_version" integer NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"current_step_id" text,
	"viewed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"solved" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_try" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hints_used" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_try_checks" integer DEFAULT 0 NOT NULL,
	"total_checks" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "lesson_progress_user_id_skill_id_pk" PRIMARY KEY("user_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "lesson_step_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"skill_id" text NOT NULL,
	"lesson_version" integer NOT NULL,
	"step_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"est_minutes" smallint NOT NULL,
	"steps" jsonb NOT NULL,
	"key_results" jsonb NOT NULL,
	"status" text NOT NULL,
	"author_id" uuid,
	"reviewer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_skill_id_version_pk" PRIMARY KEY("skill_id","version")
);
--> statement-breakpoint
CREATE TABLE "misconceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"label" text NOT NULL,
	"explanation" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"firm" text,
	"stage" text,
	"result" text,
	"readiness_at_time" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "readiness_snapshots" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"readiness" integer,
	"raw_readiness" integer NOT NULL,
	"provisional" boolean NOT NULL,
	"validated" boolean NOT NULL,
	"domain_scores" jsonb NOT NULL,
	"status_counts" jsonb NOT NULL,
	"event" text,
	CONSTRAINT "readiness_snapshots_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "readings" (
	"skill_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remediation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"cause" text NOT NULL,
	"misconception_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_item_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid,
	"skill_id" text NOT NULL,
	"template_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"seed" integer NOT NULL,
	"instance_hash" text NOT NULL,
	"band" smallint NOT NULL,
	"type" text NOT NULL,
	"submitted_raw" text,
	"y" double precision NOT NULL,
	"correct" boolean NOT NULL,
	"timed_out" boolean NOT NULL,
	"within_limit" boolean NOT NULL,
	"seen_before" boolean NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"client_elapsed_ms" integer,
	"timing_flag" boolean DEFAULT false NOT NULL,
	"p_pred" double precision NOT NULL,
	"theta_before" double precision NOT NULL,
	"theta_after" double precision NOT NULL,
	"b_before" double precision NOT NULL,
	"b_after" double precision NOT NULL,
	"level_before" smallint NOT NULL,
	"level_after" smallint NOT NULL,
	"item_response_count" integer NOT NULL,
	"set_size" integer,
	"misconception_id" text,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid,
	"position" integer NOT NULL,
	"kind" text DEFAULT 'item' NOT NULL,
	"bucket" text,
	"skill_id" text NOT NULL,
	"template_id" text,
	"template_version" integer,
	"seed" integer,
	"instance_hash" text,
	"band" smallint,
	"status" text DEFAULT 'planned' NOT NULL,
	"served_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"elapsed_ms" integer,
	"predicted_p" double precision,
	"progress" jsonb,
	"verdict" jsonb
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"target_items" integer NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" jsonb,
	"readiness_before" integer,
	"readiness_after" integer
);
--> statement-breakpoint
CREATE TABLE "skill_prereqs" (
	"skill_id" text NOT NULL,
	"prereq_id" text NOT NULL,
	CONSTRAINT "skill_prereqs_skill_id_prereq_id_pk" PRIMARY KEY("skill_id","prereq_id")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"name" text NOT NULL,
	"band" smallint NOT NULL,
	"importance" smallint NOT NULL,
	"lesson_minutes" smallint NOT NULL,
	"tier" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_skill_state" (
	"user_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"theta" double precision NOT NULL,
	"level" smallint DEFAULT 0 NOT NULL,
	"cold_streak" smallint DEFAULT 0 NOT NULL,
	"stability_s" double precision NOT NULL,
	"last_correct_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"level_attempts" integer DEFAULT 0 NOT NULL,
	"inferred" boolean DEFAULT false NOT NULL,
	"last_passed_band" smallint,
	"recent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entry_band" smallint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_skill_state_user_id_skill_id_pk" PRIMARY KEY("user_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"name" text,
	"image" text,
	"role" text DEFAULT 'learner' NOT NULL,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"archetype_id" text,
	"interview_date" date,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarding" text DEFAULT 'new' NOT NULL,
	"age_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_templates" ADD CONSTRAINT "item_templates_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_step_events" ADD CONSTRAINT "lesson_step_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconceptions" ADD CONSTRAINT "misconceptions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_snapshots" ADD CONSTRAINT "readiness_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation" ADD CONSTRAINT "remediation_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_session_item_id_session_items_id_fk" FOREIGN KEY ("session_item_id") REFERENCES "public"."session_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_items" ADD CONSTRAINT "session_items_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_items" ADD CONSTRAINT "session_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_items" ADD CONSTRAINT "session_items_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_prereqs" ADD CONSTRAINT "skill_prereqs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_prereqs" ADD CONSTRAINT "skill_prereqs_prereq_id_skills_id_fk" FOREIGN KEY ("prereq_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skill_state" ADD CONSTRAINT "user_skill_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skill_state" ADD CONSTRAINT "user_skill_state_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_name_idx" ON "events" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "item_templates_skill_idx" ON "item_templates" USING btree ("skill_id","band") WHERE usage = 'practice';--> statement-breakpoint
CREATE INDEX "lesson_step_events_skill_idx" ON "lesson_step_events" USING btree ("skill_id","lesson_version","step_id");--> statement-breakpoint
CREATE INDEX "remediation_open_idx" ON "remediation" USING btree ("user_id") WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX "responses_user_skill_idx" ON "responses" USING btree ("user_id","skill_id","created_at") WHERE voided_at is null;--> statement-breakpoint
CREATE INDEX "responses_seen_idx" ON "responses" USING btree ("user_id","template_id","instance_hash");--> statement-breakpoint
CREATE INDEX "responses_template_idx" ON "responses" USING btree ("template_id","template_version","created_at");--> statement-breakpoint
CREATE INDEX "session_items_session_idx" ON "session_items" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX "session_items_sweeper_idx" ON "session_items" USING btree ("status","served_at") WHERE status in ('served','grading');--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "user_skill_state_due_idx" ON "user_skill_state" USING btree ("user_id","due_at") WHERE due_at is not null;