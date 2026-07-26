import { NextResponse } from "next/server";
import { presignGet, getAuthedUser, ownsKey, r2Configured } from "@/lib/r2";

export const runtime = "nodejs";

export async function POST(req) {
  if (!r2Configured) return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { key } = await req.json().catch(() => ({}));
  if (!ownsKey(user, key)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = await presignGet(key);
  return NextResponse.json({ url });
}
