CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"domain_key" text NOT NULL,
	"gsc_property" text,
	"bing_site" text,
	"city" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"locale" text NOT NULL,
	"country" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_status_check" CHECK ("sites"."status" in ('active', 'paused')),
	CONSTRAINT "sites_lat_check" CHECK ("sites"."lat" between -90 and 90),
	CONSTRAINT "sites_lng_check" CHECK ("sites"."lng" between -180 and 180),
	CONSTRAINT "sites_country_check" CHECK ("sites"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sites_organization_domain_key_uidx" ON "sites" USING btree ("organization_id","domain_key");