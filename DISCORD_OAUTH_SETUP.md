# Discord Auto-Join at Signup — Setup

Lets a student **connect Discord during signup** and be **added to the server automatically**
(no manual invite click). Until this is configured, signup falls back to **honor-mode** (invite
link + "I've joined" checkbox), so the portal keeps working with zero setup.

**How it works:** the signup form opens a popup → `/api/discord/start` → Discord consent
(`identify guilds.join`) → `/api/discord/callback` exchanges the code, reads the user, and calls
`PUT /guilds/{id}/members/{user}` with the **bot token** to add them → the popup reports the
Discord id + username back to the form, which stores them on the new profile.

---

## 1. Create the Discord application
1. https://discord.com/developers/applications → **New Application** → name it `ZeroDay Reapers Portal`.
2. **OAuth2** tab → copy the **Client ID** and **Client Secret**.
3. **OAuth2 → Redirects** → **Add Redirect** →
   - `https://zerodayreapers.me/api/discord/callback`
   - `http://localhost:3000/api/discord/callback` (for local testing)
   Save. (The redirect must match the site origin exactly, path included.)

## 2. Create the bot + add it to the server
1. **Bot** tab → **Add Bot** → **Reset Token** → copy the **Bot Token** (secret).
2. The bot must be **in the server** with permission to add members. Generate an invite:
   **OAuth2 → URL Generator** → scope **`bot`** → bot permission **Create Instant Invite**
   (this is what `guilds.join` requires) → open the generated URL → add it to `ZeroDay Reapers`.
   - The bot's role must sit **above** the roles it grants and it needs Create Instant Invite; if
     `PUT member` returns 403, that's the cause.

## 3. Get the numeric Guild ID
Discord → User Settings → **Advanced** → enable **Developer Mode** → right-click the server icon →
**Copy Server ID**. (This is the numeric id — *not* the `JATEvx9FED` invite code.)

## 4. Environment variables
Add to `.env.local` **and** Vercel (main project) → redeploy:
```
NEXT_PUBLIC_DISCORD_CLIENT_ID=your_client_id     # public — presence of this flips signup into OAuth mode
DISCORD_CLIENT_SECRET=your_client_secret          # server-only
DISCORD_BOT_TOKEN=your_bot_token                  # server-only
DISCORD_GUILD_ID=123456789012345678               # numeric server id
# NEXT_PUBLIC_DISCORD_INVITE=https://discord.com/invite/JATEvx9FED   # honor-mode fallback only
```
The moment `NEXT_PUBLIC_DISCORD_CLIENT_ID` is set, the signup form shows **"Connect Discord"**
instead of the honor-mode checkbox.

## 5. Test
1. Open `/portal` → Sign up → pick a Department + RAM → **Connect Discord** → authorize.
2. The popup should close and the form should read **"✓ Discord connected as …"**; you should now be
   a member of the server. Finish signup.
3. If it fails, the popup shows the reason (e.g. state mismatch, missing perms, 403). Common fixes:
   - **403 on add:** bot lacks *Create Instant Invite* or its role is too low.
   - **Redirect/invalid_grant:** the redirect URI in the Discord app doesn't match the site origin.

## Notes
- The `discord_id` / `discord_username` are stored on the profile by migration
  `023_discord_and_classroom.sql` (run it in Supabase).
- To enforce **one Discord account per portal account**, uncomment the partial unique index at the
  bottom of `023_discord_and_classroom.sql`.
- The final "connected ✓" signal is reported to the form client-side (the *join itself* is real and
  server-side). If you later need un-spoofable gating, move account creation into a server route that
  verifies Discord before calling `auth.admin.createUser` — a larger change, deliberately deferred.
