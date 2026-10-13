ALTER TABLE "sites" ADD COLUMN "verification_token" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "verification_method" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "verification_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "verification_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_verification_check" CHECK (("sites"."verified_at" is null) = ("sites"."verification_method" is null)
        and ("sites"."verification_method" is null or "sites"."verification_method" in ('dns', 'meta', 'staff')));