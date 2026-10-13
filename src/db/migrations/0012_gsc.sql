CREATE TABLE "collector_state" (
	"site_id" text NOT NULL,
	"source" text NOT NULL,
	"property" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"oldest" date,
	"newest" date,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collector_state_site_id_source_pk" PRIMARY KEY("site_id","source"),
	CONSTRAINT "collector_state_source_check" CHECK ("collector_state"."source" in ('gsc', 'bing', 'inspection')),
	CONSTRAINT "collector_state_status_check" CHECK ("collector_state"."status" in ('pending', 'ok', 'no_access', 'error'))
);
--> statement-breakpoint
CREATE TABLE "gsc_daily" (
	"site_id" text NOT NULL,
	"date" date NOT NULL,
	"query" text NOT NULL,
	"page" text NOT NULL,
	"country" text NOT NULL,
	"device" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"ctr" double precision NOT NULL,
	"position" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_totals_daily" (
	"site_id" text NOT NULL,
	"date" date NOT NULL,
	"country" text NOT NULL,
	"device" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"ctr" double precision NOT NULL,
	"position" double precision NOT NULL,
	CONSTRAINT "gsc_totals_daily_site_id_date_country_device_pk" PRIMARY KEY("site_id","date","country","device")
);
--> statement-breakpoint
ALTER TABLE "collector_state" ADD CONSTRAINT "collector_state_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_daily" ADD CONSTRAINT "gsc_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_totals_daily" ADD CONSTRAINT "gsc_totals_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gsc_daily_site_date_idx" ON "gsc_daily" USING btree ("site_id","date");