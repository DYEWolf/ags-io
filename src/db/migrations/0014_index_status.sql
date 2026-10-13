CREATE TABLE "index_status" (
	"site_id" text NOT NULL,
	"url" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verdict" text NOT NULL,
	"coverage_state" text,
	"indexing_state" text,
	"robots_txt_state" text,
	"page_fetch_state" text,
	"last_crawl_time" timestamp with time zone,
	"google_canonical" text,
	"user_canonical" text,
	"crawled_as" text,
	CONSTRAINT "index_status_site_id_url_checked_at_pk" PRIMARY KEY("site_id","url","checked_at")
);
--> statement-breakpoint
CREATE TABLE "inspection_quota" (
	"property" text NOT NULL,
	"day" date NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inspection_quota_property_day_pk" PRIMARY KEY("property","day")
);
--> statement-breakpoint
ALTER TABLE "index_status" ADD CONSTRAINT "index_status_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "index_status_site_checked_idx" ON "index_status" USING btree ("site_id","checked_at");