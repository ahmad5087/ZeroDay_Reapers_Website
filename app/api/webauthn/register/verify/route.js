import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getUserFromReq, serviceClient, rpFromReq } from "@/lib/webauthn";

export const runtime = "nodejs";

// Step 2 of enrollment: verify the attestation against the stored challenge and save the credential.
export async function POST(req) {
  const user = await getUserFromReq(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { rpID, origin } = rpFromReq(req);
  const { response, nickname } = await req.json().catch(() => ({}));
  if (!response) return NextResponse.json({ error: "missing response" }, { status: 400 });
  const db = serviceClient();

  const { data: ch } = await db.from("webauthn_challenges")
    .select("id,challenge").eq("user_id", user.id).eq("kind", "register")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!ch) return NextResponse.json({ error: "no active challenge" }, { status: 400 });

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  await db.from("webauthn_challenges").delete().eq("id", ch.id);

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ verified: false }, { status: 400 });
  }
  // @simplewebauthn v13: registrationInfo.credential = { id (base64url), publicKey (Uint8Array), counter, transports }
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const publicKeyB64 = Buffer.from(credential.publicKey).toString("base64url");

  const { error } = await db.from("webauthn_credentials").insert({
    user_id: user.id,
    credential_id: credential.id,
    public_key: publicKeyB64,
    counter: credential.counter || 0,
    transports: credential.transports || null,
    device_type: credentialDeviceType || null,
    backed_up: !!credentialBackedUp,
    nickname: (nickname || "").slice(0, 60) || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ verified: true });
}
