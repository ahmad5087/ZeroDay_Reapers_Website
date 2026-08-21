import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getUserFromReq, serviceClient, rpFromReq } from "@/lib/webauthn";

export const runtime = "nodejs";

// Step 1 of enrollment: issue registration options for the logged-in user + persist the challenge.
export async function POST(req) {
  const user = await getUserFromReq(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { rpID } = rpFromReq(req);
  const db = serviceClient();

  const { data: creds } = await db.from("webauthn_credentials").select("credential_id,transports").eq("user_id", user.id);
  const { data: prof } = await db.from("profiles").select("display_name,email").eq("id", user.id).maybeSingle();

  const options = await generateRegistrationOptions({
    rpName: "ZeroDay Reapers",
    rpID,
    userName: prof?.email || user.email || user.id,
    userDisplayName: prof?.display_name || "Intern",
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: (creds || []).map((c) => ({ id: c.credential_id, transports: c.transports || undefined })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });

  await db.from("webauthn_challenges").insert({
    user_id: user.id, challenge: options.challenge, kind: "register",
    expires_at: new Date(Date.now() + 300000).toISOString(),
  });
  return NextResponse.json(options);
}
