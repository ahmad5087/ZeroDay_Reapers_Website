import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getUserFromReq, serviceClient, rpFromReq } from "@/lib/webauthn";

export const runtime = "nodejs";

// Step-up authentication (the user is already signed in via Supabase). Issue options + store challenge.
export async function POST(req) {
  const user = await getUserFromReq(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { rpID } = rpFromReq(req);
  const db = serviceClient();

  const { data: creds } = await db.from("webauthn_credentials").select("credential_id,transports").eq("user_id", user.id);
  if (!creds?.length) return NextResponse.json({ error: "no passkeys enrolled" }, { status: 400 });

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c) => ({ id: c.credential_id, transports: c.transports || undefined })),
    userVerification: "preferred",
  });
  await db.from("webauthn_challenges").insert({
    user_id: user.id, challenge: options.challenge, kind: "auth",
    expires_at: new Date(Date.now() + 300000).toISOString(),
  });
  return NextResponse.json(options);
}
