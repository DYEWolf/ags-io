CREATE TABLE "psi_results" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "psi_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"audit_id" text NOT NULL,
	"site_id" text NOT NULL,
	"url" text NOT NULL,
	"strategy" text NOT NULL,
	"lab" jsonb,
	"field" jsonb,
	"lighthouse_version" text,
	"error" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "psi_results_strategy_check" CHECK ("psi_results"."strategy" in ('mobile', 'desktop'))
);
--> statement-breakpoint
ALTER TABLE "psi_results" ADD CONSTRAINT "psi_results_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "psi_results" ADD CONSTRAINT "psi_results_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "psi_results_audit_idx" ON "psi_results" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "psi_results_site_url_idx" ON "psi_results" USING btree ("site_id","url","fetched_at");