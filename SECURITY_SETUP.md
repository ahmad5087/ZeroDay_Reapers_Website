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
- **Client widget is already wired.** `AuthScreen.jsx` renders a Cloudflare **Turnstile** widget on **every** auth action (login, signup, forgot-password, magic-link) and passes the token to Supabase (`captchaToken`). Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to your own site key (a public test key is the default), and paste the matching **secret** into Supabase Attack Protection. Because the CAPTCHA gates every login, brute-force is throttled up front (in addition to Supabase's own auth rate limits) — no separate "after N failed attempts" lockout is needed.

## 4. Email confirmation (production)
- Supabase → **Authentication → Sign In / Providers → Email** → turn **Confirm email ON** for production (OFF is fine for testing).
- Make sure **Authentication → URL Configuration → Site URL** = `https://zerodayreapers.me` and Redirect URLs include `https://zerodayreapers.me/**` (so confirmation links don't point at localhost).

## 5. (Optional) Full Content-Security-Policy rollout
`next.config.mjs` already ships a **safe CSP subset** (`base-uri`, `object-src 'none'`,
`frame-ancestors 'none'`, `form-action`) plus HSTS, `X-Frame-Options`, `nosniff`,
`Referrer-Policy`, and `Permissions-Policy`. It deliberately does **not** restrict
`script-src` / `connect-src` / `img-src`, so it can't break Turnstile, Supabase, or R2.

To reach a strict, XSS-blocking CSP later, add a **nonce-based** policy via a Next.js
`middleware.js` (generate a per-request nonce, pass it to the script tags, and emit a CSP
like below). Test on a preview deploy first — a wrong allowlist will break auth or uploads.
```
default-src 'self';
script-src 'self' 'nonce-<generated>' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://*.supabase.co https://*.r2.cloudflarestorage.com;
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.r2.cloudflarestorage.com https://api.web3forms.com;
frame-src https://challenges.cloudflare.com;
frame-ancestors 'none'; base-uri 'self'; object-src 'none';
form-action 'self' https://api.web3forms.com;
```
Adjust the R2 host to your actual bucket endpoint / custom domain before enabling.

---

## Already built in code (no dashboard action)
- **Profanity/NSFW AutoMod** — DB trigger `automod_check_message` (008) removes the message + 10-min timeout; client `_lib.js` mirrors the list for instant feedback.
- **Link moderation** — non-admin links held `pending` for admin approval (009).
- **Rate limiting** — 5 messages / 10s (`rate_limit_messages`, schema).
- **Admin audit log** — every admin action (ban/timeout/domain/status/delete/graduate/fee) logged to `admin_actions`, viewable in the Admin panel (014).
- **Message reports** — students can report a message; admins review/resolve in the Admin panel (014).
- **PII lockdown** — email/full name readable only by owner + admins (`public_profiles` view).
- **Security headers** — `next.config.mjs` sends HSTS (2y, preload), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` (camera/mic/geo/topics off), and a base CSP; `poweredByHeader` is off.
- **File-upload validation** — `/api/r2/upload-url` enforces a per-kind extension allowlist +
  max size + binds ContentType into the presigned PUT; keys are namespaced to the caller's
  `{uid}/` folder. `download-url` / `delete` gate every key through `ownsKey()`.
- **CSRF posture** — the app authenticates APIs with Supabase **bearer JWTs** (Authorization
  header, session in localStorage — not cookies), so classic cookie-CSRF doesn't apply; the one
  cookie set (Discord OAuth `state`) is `httpOnly` + `secure` + `sameSite=lax` and validated on callback.
- **Encryption / password storage** — TLS in transit everywhere (HSTS-reinforced); at rest via
  Supabase Postgres + Cloudflare R2. Passwords are hashed by Supabase Auth (bcrypt) — the app
  never sees or stores raw passwords (12-char policy + strength meter on top).
