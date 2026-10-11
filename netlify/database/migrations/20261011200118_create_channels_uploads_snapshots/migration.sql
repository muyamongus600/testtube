CREATE TABLE "channels" (
	"id" serial PRIMARY KEY,
	"handle" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" serial PRIMARY KEY,
	"channel_id" integer NOT NULL,
	"subscribers" bigint NOT NULL,
	"views" bigint DEFAULT 0 NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" serial PRIMARY KEY,
	"channel_id" integer NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT 'Video' NOT NULL,
	"views" bigint DEFAULT 0 NOT NULL,
	"likes" bigint DEFAULT 0 NOT NULL,
	"dislikes" bigint DEFAULT 0 NOT NULL,
	"comments" bigint DEFAULT 0 NOT NULL,
	"avg_watch_time" integer DEFAULT 0 NOT NULL,
	"posted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "snapshots_channel_time_idx" ON "snapshots" ("channel_id","recorded_at");--> statement-breakpoint
CREATE INDEX "uploads_channel_idx" ON "uploads" ("channel_id");--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_channel_id_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_channel_id_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE;