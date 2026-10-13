CREATE TABLE "mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"competitor_id" text,
	"match_count" integer NOT NULL,
	"ambiguous" boolean NOT NULL,
	"review" text DEFAULT 'auto' NOT NULL,
	"snippet" text NOT NULL,
	"term" text NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mentions_run_entity_uq" UNIQUE NULLS NOT DISTINCT("run_id","entity_type","competitor_id"),
	CONSTRAINT "mentions_entity_check" CHECK (("mentions"."entity_type" = 'brand' and "mentions"."competitor_id" is null) or ("mentions"."entity_type" = 'competitor' and "mentions"."competitor_id" is not null)),
	CONSTRAINT "mentions_review_check" CHECK ("mentions"."review" in ('auto', 'confirmed', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_run_id_llm_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."llm_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mentions_competitor_idx" ON "mentions" USING btree ("competitor_id");