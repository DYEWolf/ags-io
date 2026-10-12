CREATE TABLE "brand_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"alias" text NOT NULL,
	"alias_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"domains" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"text" text NOT NULL,
	"text_key" text NOT NULL,
	"intent" text NOT NULL,
	"branded" boolean NOT NULL,
	"locale" text NOT NULL,
	"location" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompts_intent_check" CHECK ("prompts"."intent" in ('category', 'evaluation', 'decision'))
);
--> statement-breakpoint
ALTER TABLE "brand_aliases" ADD CONSTRAINT "brand_aliases_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_aliases_site_alias_key_uidx" ON "brand_aliases" USING btree ("site_id","alias_key");--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_site_name_key_uidx" ON "competitors" USING btree ("site_id","name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_site_text_key_uidx" ON "prompts" USING btree ("site_id","text_key");