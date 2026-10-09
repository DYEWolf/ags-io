CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"organization_id" text,
	"site_id" text,
	"payload" jsonb NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "alerts_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "spend_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "spend_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"job" text NOT NULL,
	"job_id" text,
	"organization_id" text,
	"site_id" text,
	"estimated_cost_usd" numeric(12, 6) NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "spend_ledger_status_check" CHECK ("spend_ledger"."status" in ('pending', 'ok', 'error')),
	CONSTRAINT "spend_ledger_cost_check" CHECK ("spend_ledger"."cost_usd" >= 0 and "spend_ledger"."estimated_cost_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "spend_limits" (
	"scope" text NOT NULL,
	"key" text DEFAULT '' NOT NULL,
	"monthly_usd" numeric(12, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "spend_limits_scope_key_pk" PRIMARY KEY("scope","key"),
	CONSTRAINT "spend_limits_scope_check" CHECK ("spend_limits"."scope" in ('global', 'provider', 'organization', 'organization_default')),
	CONSTRAINT "spend_limits_amount_check" CHECK ("spend_limits"."monthly_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_limits" ADD CONSTRAINT "spend_limits_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_last_at_idx" ON "alerts" USING btree ("last_at");--> statement-breakpoint
CREATE INDEX "spend_ledger_at_idx" ON "spend_ledger" USING btree ("at");--> statement-breakpoint
CREATE INDEX "spend_ledger_provider_at_idx" ON "spend_ledger" USING btree ("provider","at");--> statement-breakpoint
CREATE INDEX "spend_ledger_organization_at_idx" ON "spend_ledger" USING btree ("organization_id","at");