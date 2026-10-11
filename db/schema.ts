import { pgTable, serial, text, timestamp, integer, bigint, boolean, index } from "drizzle-orm/pg-core";

export const channels = pgTable("channels", {
  id: serial().primaryKey(),
  handle: text().notNull().unique(),
  name: text().notNull(),
  image: text().notNull().default(""),
  verified: boolean().notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const uploads = pgTable(
  "uploads",
  {
    id: serial().primaryKey(),
    channelId: integer("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    title: text().notNull(),
    type: text().notNull().default("Video"),
    views: bigint({ mode: "number" }).notNull().default(0),
    likes: bigint({ mode: "number" }).notNull().default(0),
    dislikes: bigint({ mode: "number" }).notNull().default(0),
    comments: bigint({ mode: "number" }).notNull().default(0),
    avgWatchTime: integer("avg_watch_time").notNull().default(0),
    postedAt: timestamp("posted_at").notNull().defaultNow(),
  },
  (t) => [index("uploads_channel_idx").on(t.channelId)],
);

// Point-in-time subscriber/view counts, used for the growth chart.
export const snapshots = pgTable(
  "snapshots",
  {
    id: serial().primaryKey(),
    channelId: integer("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    subscribers: bigint({ mode: "number" }).notNull(),
    views: bigint({ mode: "number" }).notNull().default(0),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("snapshots_channel_time_idx").on(t.channelId, t.recordedAt)],
);
