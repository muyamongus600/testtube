import type { Config } from "@netlify/functions";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { channels, snapshots, uploads } from "../../db/schema.js";

const UPLOAD_TYPES = ["Video", "Short", "Stream", "Song", "Podcast"];
const DAY = 24 * 60 * 60 * 1000;

const json = (data: unknown, status = 200) => Response.json(data, { status });
const bad = (message: string, status = 400) => json({ error: message }, status);

const toInt = (v: unknown, fallback = 0) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const toText = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// When ADMIN_KEY is set, writes require a matching x-admin-key header.
function canWrite(req: Request) {
  const key = Netlify.env.get("ADMIN_KEY");
  return !key || req.headers.get("x-admin-key") === key;
}

async function listChannels() {
  const latest = db
    .selectDistinctOn([snapshots.channelId], {
      channelId: snapshots.channelId,
      subscribers: snapshots.subscribers,
    })
    .from(snapshots)
    .orderBy(snapshots.channelId, desc(snapshots.recordedAt))
    .as("latest");

  return db
    .select({
      id: channels.id,
      handle: channels.handle,
      name: channels.name,
      image: channels.image,
      verified: channels.verified,
      subscribers: sql<number>`coalesce(${latest.subscribers}, 0)`.mapWith(Number),
    })
    .from(channels)
    .leftJoin(latest, eq(latest.channelId, channels.id))
    .orderBy(desc(sql`coalesce(${latest.subscribers}, 0)`));
}

async function channelDetail(id: number) {
  const [channel] = await db.select().from(channels).where(eq(channels.id, id));
  if (!channel) return null;

  const [uploadRows, history] = await Promise.all([
    db.select().from(uploads).where(eq(uploads.channelId, id)).orderBy(desc(uploads.postedAt)),
    db
      .select({ subscribers: snapshots.subscribers, views: snapshots.views, recordedAt: snapshots.recordedAt })
      .from(snapshots)
      .where(eq(snapshots.channelId, id))
      .orderBy(asc(snapshots.recordedAt)),
  ]);

  return { channel, uploads: uploadRows, history };
}

async function seedDemo() {
  const [{ count }] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(channels);
  if (count > 0) return false;

  const demo = [
    { handle: "sfmg", name: "SFMG", verified: true, base: 182_000, growth: 1_450 },
    { handle: "pixelforge", name: "PixelForge", verified: false, base: 46_000, growth: 520 },
    { handle: "lofilane", name: "Lofi Lane", verified: true, base: 91_000, growth: -120 },
  ];
  const titles = [
    "Building a city in 24 hours", "I tried every speedrun trick", "Reacting to your edits",
    "Late-night stream highlights", "The algorithm explained", "100 days of animation",
    "Q&A with the community", "Rating subscriber setups", "Chill beats to code to",
    "Behind the scenes of the channel", "We broke the record", "My worst upload ever",
  ];

  const now = Date.now();
  for (const [ci, c] of demo.entries()) {
    const [row] = await db
      .insert(channels)
      .values({ handle: c.handle, name: c.name, verified: c.verified })
      .returning({ id: channels.id });

    const points = Array.from({ length: 60 }, (_, i) => {
      const day = 59 - i;
      const wobble = Math.round(Math.sin(i / 4 + ci) * c.growth * 0.6);
      return {
        channelId: row.id,
        subscribers: Math.max(0, c.base + i * c.growth + wobble),
        views: (c.base + i * c.growth) * 38 + i * 9_000,
        recordedAt: new Date(now - day * DAY),
      };
    });
    await db.insert(snapshots).values(points);

    const vids = titles.slice(ci * 2, ci * 2 + 9).map((title, i) => {
      const views = Math.round(c.base * (0.4 + ((i * 37 + ci * 11) % 23) / 6));
      return {
        channelId: row.id,
        title,
        type: UPLOAD_TYPES[(i + ci) % UPLOAD_TYPES.length],
        views,
        likes: Math.round(views * 0.045),
        dislikes: Math.round(views * 0.002),
        comments: Math.round(views * 0.006),
        avgWatchTime: 30 + ((i * 13 + ci * 7) % 50),
        postedAt: new Date(now - (i * 6 + 1) * DAY),
      };
    });
    await db.insert(uploads).values(vids);
  }
  return true;
}

export default async (req: Request) => {
  const segments = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [resource, rawId, sub] = segments;
  const isWrite = req.method !== "GET";

  if (isWrite && !canWrite(req)) return bad("A valid admin key is required to make changes.", 401);

  try {
    if (resource === "seed" && req.method === "POST") {
      const seeded = await seedDemo();
      return json({ seeded });
    }

    if (resource !== "channels") return bad("Not found", 404);

    if (!rawId) {
      if (req.method === "GET") return json(await listChannels());
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const handle = toText(body.handle, 60).replace(/^@/, "").toLowerCase();
        const name = toText(body.name, 100);
        if (!handle || !name) return bad("Handle and name are required.");
        if (!/^[a-z0-9_.-]+$/.test(handle)) return bad("Handle may only use letters, numbers, _ . and -");

        const existing = await db.select({ id: channels.id }).from(channels).where(eq(channels.handle, handle));
        if (existing.length) return bad("A channel with that handle already exists.", 409);

        const [channel] = await db
          .insert(channels)
          .values({ handle, name, image: toText(body.image, 500), verified: body.verified === true })
          .returning();
        if (body.subscribers !== undefined && body.subscribers !== "") {
          await db.insert(snapshots).values({
            channelId: channel.id,
            subscribers: toInt(body.subscribers),
            views: toInt(body.views),
          });
        }
        return json(channel, 201);
      }
      return bad("Method not allowed", 405);
    }

    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return bad("Invalid channel id");

    if (!sub) {
      if (req.method === "GET") {
        const detail = await channelDetail(id);
        return detail ? json(detail) : bad("Channel not found", 404);
      }
      if (req.method === "DELETE") {
        await db.delete(channels).where(eq(channels.id, id));
        return json({ deleted: true });
      }
      return bad("Method not allowed", 405);
    }

    const [exists] = await db.select({ id: channels.id }).from(channels).where(eq(channels.id, id));
    if (!exists) return bad("Channel not found", 404);
    if (req.method !== "POST") return bad("Method not allowed", 405);
    const body = await req.json().catch(() => ({}));

    if (sub === "uploads") {
      const title = toText(body.title, 200);
      if (!title) return bad("Title is required.");
      const type = UPLOAD_TYPES.includes(body.type) ? body.type : "Video";
      const postedAt = body.postedAt ? new Date(body.postedAt) : new Date();
      const [upload] = await db
        .insert(uploads)
        .values({
          channelId: id,
          title,
          type,
          views: toInt(body.views),
          likes: toInt(body.likes),
          dislikes: toInt(body.dislikes),
          comments: toInt(body.comments),
          avgWatchTime: Math.min(100, toInt(body.avgWatchTime)),
          postedAt: isNaN(postedAt.getTime()) ? new Date() : postedAt,
        })
        .returning();
      return json(upload, 201);
    }

    if (sub === "snapshots") {
      if (body.subscribers === undefined || body.subscribers === "") return bad("Subscribers is required.");
      const [snapshot] = await db
        .insert(snapshots)
        .values({ channelId: id, subscribers: toInt(body.subscribers), views: toInt(body.views) })
        .returning();
      return json(snapshot, 201);
    }

    return bad("Not found", 404);
  } catch (err) {
    console.error(err);
    return bad("Something went wrong talking to the database.", 500);
  }
};

export const config: Config = {
  path: "/api/*",
};
