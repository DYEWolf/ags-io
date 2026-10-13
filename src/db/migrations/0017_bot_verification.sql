CREATE TABLE "bot_ip_ranges" (
	"source" text NOT NULL,
	"prefix" "inet" NOT NULL,
	CONSTRAINT "bot_ip_ranges_source_prefix_pk" PRIMARY KEY("source","prefix")
);
--> statement-breakpoint
CREATE TABLE "bot_range_sources" (
	"source" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"prefixes" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_verifications" (
	"ip" "inet" NOT NULL,
	"bot" text NOT NULL,
	"verified" text NOT NULL,
	"method" text NOT NULL,
	"hostname" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ip_verifications_ip_bot_pk" PRIMARY KEY("ip","bot"),
	CONSTRAINT "ip_verifications_verified_check" CHECK ("ip_verifications"."verified" in ('verified', 'failed', 'unverified'))
);
--> statement-breakpoint
ALTER TABLE "bot_ip_ranges" ADD CONSTRAINT "bot_ip_ranges_source_bot_range_sources_source_fk" FOREIGN KEY ("source") REFERENCES "public"."bot_range_sources"("source") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_ip_ranges_prefix_idx" ON "bot_ip_ranges" USING gist ("prefix" inet_ops);