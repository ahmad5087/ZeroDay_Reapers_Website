export const runtime = "nodejs";

// Completes Discord OAuth: exchanges the code, reads the user, and adds them to the guild
// via the bot token (guilds.join). Returns a popup page that posts the result back to the
// signup form (AuthScreen listens for `zdr-discord-auth`). All failures are reported, not thrown.
export async function GET(req) {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("zdr_discord_state")?.value;

  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;

  try {
    if (!clientId || !clientSecret || !botToken || !guildId) throw new Error("Discord isn't fully configured.");
    if (!code) throw new Error("Missing authorization code.");
    if (!state || !cookieState || state !== cookieState) throw new Error("Session mismatch — please retry.");

    const redirectUri = `${origin}/api/discord/callback`;
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error("Token exchange failed.");
    const token = await tokenRes.json();

    const meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!meRes.ok) throw new Error("Could not read your Discord profile.");
    const me = await meRes.json();

    // Add to the server (201 = added now, 204 = already a member). Requires the bot to be in
    // the guild with the Create Instant Invite permission (see DISCORD_OAUTH_SETUP.md).
    const joinRes = await fetch(`https://discord.com/api/guilds/${guildId}/members/${me.id}`, {
      method: "PUT",
      headers: { Authorization: `Bot ${botToken}`, "content-type": "application/json" },
      body: JSON.stringify({ access_token: token.access_token }),
    });
    if (joinRes.status !== 201 && joinRes.status !== 204) {
      throw new Error(`Couldn't add you to the server (${joinRes.status}).`);
    }

    return html(origin, { ok: true, id: me.id, username: me.global_name || me.username });
  } catch (e) {
    return html(origin, { ok: false, error: e.message || "Discord error" });
  }
}

function html(origin, payload) {
  const body = `<!doctype html><meta charset="utf-8"><body style="background:#050505;color:#e5e5e5;font-family:monospace;padding:24px">
<p>${payload.ok ? "Discord connected. You can close this window." : "Discord: " + (payload.error || "error")}</p>
<script>try{window.opener&&window.opener.postMessage(Object.assign({type:"zdr-discord-auth"},${JSON.stringify(payload)}),${JSON.stringify(origin)});}catch(e){}setTimeout(function(){window.close();},900);</script>
</body>`;
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}
