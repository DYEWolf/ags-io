CREATE TABLE "audit_findings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_findings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"audit_id" text NOT NULL,
	"url" text,
	"rule" text NOT NULL,
	"severity" text NOT NULL,
	"detail" jsonb,
	CONSTRAINT "audit_findings_severity_check" CHECK ("audit_findings"."severity" in ('error', 'warning', 'notice'))
);
--> statement-breakpoint
CREATE TABLE "audit_pages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_pages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"audit_id" text NOT NULL,
	"url" text NOT NULL,
	"final_url" text,
	"status" integer,
	"content_type" text,
	"bytes" integer,
	"ms" integer,
	"error" text,
	"facts" jsonb
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"score" integer,
	"summary" jsonb,
	"error" text,
	CONSTRAINT "audits_trigger_check" CHECK ("audits"."trigger" in ('scheduled', 'manual')),
	CONSTRAINT "audits_status_check" CHECK ("audits"."status" in ('queued', 'running', 'done', 'failed')),
	CONSTRAINT "audits_score_check" CHECK ("audits"."score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD CONSTRAINT "audit_pages_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_findings_audit_rule_idx" ON "audit_findings" USING btree ("audit_id","rule");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_pages_audit_url_uidx" ON "audit_pages" USING btree ("audit_id","url");--> statement-breakpoint
CREATE INDEX "audits_site_created_idx" ON "audits" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audits_site_pending_uidx" ON "audits" USING btree ("site_id") WHERE "audits"."status" in ('queued', 'running');