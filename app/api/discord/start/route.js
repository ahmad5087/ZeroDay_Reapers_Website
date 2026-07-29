import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

// Begins the Discord OAuth "auto-join" flow (opened in a popup by AuthScreen).
// Redirects to Discord's consent screen with the `guilds.join` scope so the callback
// can add the user to the server. Sets a short-lived state cookie for CSRF protection.
export async function GET(req) {
  const origin = new URL(req.url).origin;
  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;

  // Not configured — tell the opener so it can show a friendly message (button is hidden
  // in this case anyway, but guard defensively).
  if (!clientId) {
    return html(origin, { ok: false, error: "Discord sign-in isn't configured yet." });
  }

  const state = crypto.randomUUID();
  const redirectUri = `${origin}/api/discord/callback`;
  const authUrl = new URL("https://discord.com/api/oauth2/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "identify guilds.join");
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set("zdr_discord_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/discord",
  });
  return res;
}

// Minimal HTML that reports a result to the opener window and closes the popup.
function html(origin, payload) {
  const body = `<!doctype html><meta charset="utf-8"><body style="background:#050505;color:#e5e5e5;font-family:monospace;padding:24px">
<p>${payload.ok ? "Discord connected. You can close this window." : "Discord: " + (payload.error || "error")}</p>
<script>try{window.opener&&window.opener.postMessage(Object.assign({type:"zdr-discord-auth"},${JSON.stringify(payload)}),${JSON.stringify(origin)});}catch(e){}setTimeout(function(){window.close();},800);</script>
</body>`;
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}
