import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { getUserFromReq, serviceClient } from "@/lib/webauthn";

export const runtime = "nodejs";

// Recovery codes: the always-available fallback so passkeys can never lock a user out.
//   action "generate" → replace the code set, return the 10 plaintext codes ONCE.
//   action "verify"   → consume one unused code (used by the login step-up gate).
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const genCode = () => randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g).join("-");

export async function POST(req) {
  const user = await getUserFromReq(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { action, code } = await req.json().catch(() => ({}));
  const db = serviceClient();

  if (action === "generate") {
    await db.from("recovery_codes").delete().eq("user_id", user.id);   // one active set at a time
    const codes = Array.from({ length: 10 }, genCode);
    const { error } = await db.from("recovery_codes").insert(codes.map((c) => ({ user_id: user.id, code_hash: sha256(c) })));
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ codes });
  }

  if (action === "verify") {
    const h = sha256(String(code || "").trim().toUpperCase());
    const { data: row } = await db.from("recovery_codes")
      .select("id").eq("user_id", user.id).eq("code_hash", h).is("used_at", null).maybeSingle();
    if (!row) return NextResponse.json({ verified: false }, { status: 400 });
    await db.from("recovery_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id);
    return NextResponse.json({ verified: true });
  }

  return NextResponse.json({ error: "bad action" }, { status: 400 });
}
