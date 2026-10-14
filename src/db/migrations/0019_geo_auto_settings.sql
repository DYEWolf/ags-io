CREATE TABLE "geo_auto_settings" (
	"site_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"repetitions" integer DEFAULT 3 NOT NULL,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"engines" text[] DEFAULT '{"chatgpt"}' NOT NULL,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geo_auto_settings_repetitions_check" CHECK ("geo_auto_settings"."repetitions" between 1 and 5),
	CONSTRAINT "geo_auto_settings_frequency_check" CHECK ("geo_auto_settings"."frequency" in ('weekly', 'biweekly', 'monthly'))
);
--> statement-breakpoint
ALTER TABLE "geo_auto_settings" ADD CONSTRAINT "geo_auto_settings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_auto_settings" ADD CONSTRAINT "geo_auto_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;