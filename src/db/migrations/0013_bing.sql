CREATE TABLE "bing_daily" (
	"site_id" text NOT NULL,
	"date" date NOT NULL,
	"query" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"avg_click_position" double precision NOT NULL,
	"avg_impression_position" double precision NOT NULL,
	CONSTRAINT "bing_daily_site_id_date_query_pk" PRIMARY KEY("site_id","date","query")
);
--> statement-breakpoint
CREATE TABLE "bing_page_daily" (
	"site_id" text NOT NULL,
	"date" date NOT NULL,
	"page" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"avg_click_position" double precision NOT NULL,
	"avg_impression_position" double precision NOT NULL,
	CONSTRAINT "bing_page_daily_site_id_date_page_pk" PRIMARY KEY("site_id","date","page")
);
--> statement-breakpoint
CREATE TABLE "bing_totals_daily" (
	"site_id" text NOT NULL,
	"date" date NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	CONSTRAINT "bing_totals_daily_site_id_date_pk" PRIMARY KEY("site_id","date")
);
--> statement-breakpoint
ALTER TABLE "bing_daily" ADD CONSTRAINT "bing_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_page_daily" ADD CONSTRAINT "bing_page_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_totals_daily" ADD CONSTRAINT "bing_totals_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;