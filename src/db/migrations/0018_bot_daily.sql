CREATE TABLE "bot_daily" (
	"host_key" text NOT NULL,
	"date" date NOT NULL,
	"bot" text NOT NULL,
	"verified" text NOT NULL,
	"hits" integer NOT NULL,
	"errors_4xx" integer NOT NULL,
	"errors_5xx" integer NOT NULL,
	CONSTRAINT "bot_daily_host_key_date_bot_verified_pk" PRIMARY KEY("host_key","date","bot","verified")
);
