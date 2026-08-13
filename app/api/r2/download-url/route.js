import { NextResponse } from "next/server";
import { presignGet, getAuthedUser, ownsKey, r2Configured, rateLimit } from "@/lib/r2";

export const runtime = "nodejs";

export async function POST(req) {
  if (!r2Configured) return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit("r2-download:" + user.id, { limit: 120, windowMs: 60_000 }))
    return NextResponse.json({ error: "Too many requests — slow down." }, { status: 429 });

  const { key, filename, inline } = await req.json().catch(() => ({}));
  if (!ownsKey(user, key, { write: false })) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = await presignGet(key, typeof filename === "string" && filename ? filename : undefined, !!inline);
  return NextResponse.json({ url });
}
