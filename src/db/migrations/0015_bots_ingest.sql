CREATE TABLE "bot_hits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bot_hits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ts" timestamp with time zone NOT NULL,
	"host" text NOT NULL,
	"path" text NOT NULL,
	"status" integer NOT NULL,
	"bytes" bigint NOT NULL,
	"ua" text NOT NULL,
	"ip" "inet" NOT NULL,
	"bot" text NOT NULL,
	"verified" text DEFAULT 'unverified' NOT NULL,
	CONSTRAINT "bot_hits_verified_check" CHECK ("bot_hits"."verified" in ('verified', 'failed', 'unverified'))
);
--> statement-breakpoint
CREATE TABLE "log_cursors" (
	"file" text PRIMARY KEY NOT NULL,
	"inode" text NOT NULL,
	"inode_since" timestamp with time zone DEFAULT now() NOT NULL,
	"offset" bigint DEFAULT 0 NOT NULL,
	"draining" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bot_hits_host_ts_idx" ON "bot_hits" USING btree ("host","ts");--> statement-breakpoint
CREATE INDEX "bot_hits_ts_idx" ON "bot_hits" USING btree ("ts");