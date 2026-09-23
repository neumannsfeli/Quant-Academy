-- Tech spec §2.1 / §5: the response log is append-only. Nothing is deleted
-- except by account deletion's de-identification, and the only other update
-- permitted is voiding.
CREATE OR REPLACE FUNCTION responses_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'responses are append-only';
  END IF;
  IF (to_jsonb(NEW) - 'voided_at' - 'user_id') IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at' - 'user_id') THEN
    RAISE EXCEPTION 'responses are append-only: only voided_at may change';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'responses.user_id may only be cleared (de-identification)';
  END IF;
  IF OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at THEN
    RAISE EXCEPTION 'a voided response stays voided';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER responses_append_only
  BEFORE UPDATE OR DELETE ON responses
  FOR EACH ROW EXECUTE FUNCTION responses_append_only();
--> statement-breakpoint
-- Tech spec §19.1: the one column that walls learning off from measurement.
ALTER TABLE item_templates ADD CONSTRAINT item_templates_usage_check CHECK (usage IN ('practice', 'lesson'));
--> statement-breakpoint
ALTER TABLE item_templates ADD CONSTRAINT item_templates_status_check CHECK (status IN ('draft', 'in_review', 'live', 'retired'));
--> statement-breakpoint
ALTER TABLE session_items ADD CONSTRAINT session_items_status_check CHECK (status IN ('planned', 'served', 'grading', 'answered', 'timed_out', 'ungraded', 'abandoned', 'skipped', 'done'));
--> statement-breakpoint
ALTER TABLE user_skill_state ADD CONSTRAINT user_skill_state_level_check CHECK (level BETWEEN 0 AND 3);
--> statement-breakpoint
ALTER TABLE user_skill_state ADD CONSTRAINT user_skill_state_stability_check CHECK (stability_s BETWEEN 2 AND 180);
