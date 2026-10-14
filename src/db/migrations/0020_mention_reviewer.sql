ALTER TABLE "mentions" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "mentions" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_reviewed_by_check" CHECK ("mentions"."reviewed_by" is null or "mentions"."reviewed_by" in ('user', 'llm'));--> statement-breakpoint
-- Las revisiones anteriores son todas de personas.
UPDATE "mentions" SET "reviewed_by" = 'user' WHERE "review" <> 'auto';
