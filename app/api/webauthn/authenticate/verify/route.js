import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getUserFromReq, serviceClient, rpFromReq } from "@/lib/webauthn";

export const runtime = "nodejs";

// Verify a step-up assertion against the stored challenge + the caller's credential; bump the counter.
export async function POST(req) {
  const user = await getUserFromReq(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { rpID, origin } = rpFromReq(req);
  const { response } = await req.json().catch(() => ({}));
  if (!response?.id) return NextResponse.json({ error: "missing response" }, { status: 400 });
  const db = serviceClient();

  const { data: ch } = await db.from("webauthn_challenges")
    .select("id,challenge").eq("user_id", user.id).eq("kind", "auth")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!ch) return NextResponse.json({ error: "no active challenge" }, { status: 400 });

  const { data: cred } = await db.from("webauthn_credentials")
    .select("*").eq("user_id", user.id).eq("credential_id", response.id).maybeSingle();
  if (!cred) return NextResponse.json({ error: "unknown credential" }, { status: 400 });

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: cred.credential_id,
        publicKey: new Uint8Array(Buffer.from(cred.public_key, "base64url")),
        counter: Number(cred.counter) || 0,
        transports: cred.transports || undefined,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  await db.from("webauthn_challenges").delete().eq("id", ch.id);

  if (!verification.verified) return NextResponse.json({ verified: false }, { status: 400 });
  await db.from("webauthn_credentials")
    .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
    .eq("id", cred.id);
  return NextResponse.json({ verified: true });
}
