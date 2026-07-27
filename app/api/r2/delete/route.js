import { NextResponse } from "next/server";
import { deleteObject, getAuthedUser, ownsKey, r2Configured, rateLimit } from "@/lib/r2";

export const runtime = "nodejs";

export async function POST(req) {
  if (!r2Configured) return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit("r2-delete:" + user.id, { limit: 40, windowMs: 60_000 }))
    return NextResponse.json({ error: "Too many requests — slow down." }, { status: 429 });

  const { key } = await req.json().catch(() => ({}));
  if (!ownsKey(user, key, { write: true })) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await deleteObject(key);
  return NextResponse.json({ ok: true });
}
