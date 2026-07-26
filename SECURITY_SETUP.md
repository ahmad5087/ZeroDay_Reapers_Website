# Security Setup — Dashboard Settings

These four items are **Supabase dashboard settings** (not code). The code side is
already built; flip these switches to complete the hardening.

## 1. Enable MFA / TOTP (needed for admin 2FA)
The admin 2FA UI is built (Profile → Two-Factor Authentication → Enable 2FA; and a
code prompt at `/portal/admin` login). It needs TOTP enabled project-wide:
- Supabase → **Authentication → Sign In / Providers → Multi-Factor Authentication** → ensure **TOTP (App Authenticator)** is **enabled**.
- 2FA is **optional per admin** — each admin enables it from their Profile. If enabled, they're prompted for a 6-digit code at login.

## 2. Server-side password policy (mirror the 12-char client rule)
The signup form enforces 12+ chars with upper/lower/number/symbol client-side. Enforce it on the server too:
- Supabase → **Authentication → Sign In / Providers → Email**:
  - **Minimum password length:** `12`
  - **Password Requirements:** choose **"Lowercase, uppercase, digits, and symbols"** (strongest option)
- Now weak passwords are rejected by Supabase itself, even via the API or password reset.

## 3. Bot / signup abuse protection (CAPTCHA)
Stop automated signups:
- Supabase → **Authentication → Attack Protection** (or **Bot and Abuse Protection**) → enable **CAPTCHA**.
- Pick **Cloudflare Turnstile** (free) or **hCaptcha**, create a site at that provider, and paste the **secret key** into Supabase.
- Then add the provider's **site key** to the signup form widget. (If you enable this, tell me the provider + site key and I'll wire the widget into `AuthScreen.jsx` — it needs a small client change to render the CAPTCHA and pass the token to `signUp`.)

## 4. Email confirmation (production)
- Supabase → **Authentication → Sign In / Providers → Email** → turn **Confirm email ON** for production (OFF is fine for testing).
- Make sure **Authentication → URL Configuration → Site URL** = `https://zerodayreapers.me` and Redirect URLs include `https://zerodayreapers.me/**` (so confirmation links don't point at localhost).

---

## Already built in code (no dashboard action)
- **Profanity/NSFW AutoMod** — DB trigger `automod_check_message` (008) removes the message + 10-min timeout; client `_lib.js` mirrors the list for instant feedback.
- **Link moderation** — non-admin links held `pending` for admin approval (009).
- **Rate limiting** — 5 messages / 10s (`rate_limit_messages`, schema).
- **Admin audit log** — every admin action (ban/timeout/domain/status/delete/graduate/fee) logged to `admin_actions`, viewable in the Admin panel (014).
- **Message reports** — students can report a message; admins review/resolve in the Admin panel (014).
- **PII lockdown** — email/full name readable only by owner + admins (`public_profiles` view).
