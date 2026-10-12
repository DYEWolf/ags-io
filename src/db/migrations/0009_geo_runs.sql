CREATE TABLE "cited_domains" (
	"run_id" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"own" boolean NOT NULL,
	CONSTRAINT "cited_domains_run_id_url_pk" PRIMARY KEY("run_id","url")
);
--> statement-breakpoint
CREATE TABLE "llm_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"prompt_id" text NOT NULL,
	"site_id" text NOT NULL,
	"engine" text NOT NULL,
	"mode" text,
	"model" text,
	"source" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"raw" jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_usd" numeric(12, 6),
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_runs_engine_check" CHECK ("llm_runs"."engine" in ('chatgpt', 'perplexity', 'gemini', 'google_ai_overviews', 'google_ai_mode', 'copilot', 'claude')),
	CONSTRAINT "llm_runs_mode_check" CHECK ("llm_runs"."mode" is null or "llm_runs"."mode" in ('standard', 'web_search', 'reasoning', 'deep_research')),
	CONSTRAINT "llm_runs_source_check" CHECK ("llm_runs"."source" in ('manual', 'auto'))
);
--> statement-breakpoint
ALTER TABLE "cited_domains" ADD CONSTRAINT "cited_domains_run_id_llm_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."llm_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cited_domains_domain_idx" ON "cited_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "llm_runs_site_run_at_idx" ON "llm_runs" USING btree ("site_id","run_at");--> statement-breakpoint
CREATE INDEX "llm_runs_prompt_run_at_idx" ON "llm_runs" USING btree ("prompt_id","run_at");