CREATE TABLE "bot_rules" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bot_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"pattern" text NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"owner" text,
	"category" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_rules_kind_check" CHECK ("bot_rules"."kind" in ('bot', 'ignore')),
	CONSTRAINT "bot_rules_bot_check" CHECK ("bot_rules"."kind" = 'ignore' or ("bot_rules"."name" is not null and "bot_rules"."category" is not null))
);
--> statement-breakpoint
ALTER TABLE "bot_rules" ADD CONSTRAINT "bot_rules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_rules_pattern_idx" ON "bot_rules" USING btree (lower("pattern"));