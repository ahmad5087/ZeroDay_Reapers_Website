# Cloudflare R2 Setup — ZeroDay Reapers Portal

Task PDFs and resumes are stored in **Cloudflare R2** (10 GB free, no egress fees).
The database (users, submissions metadata, chat) stays on Supabase. Avatars stay
on Supabase Storage.

Files never go through your server — the browser uploads/downloads directly to R2
using short-lived **presigned URLs** minted by our Next.js API routes, which first
verify the user's Supabase session. R2 secrets live only on the server.

---

## 1. Create the R2 bucket
1. Cloudflare dashboard → **R2** (left sidebar) → **Create bucket**.
2. Name it `zdr-portal` (or anything — you'll put it in an env var).
3. Location: **Automatic**. Create.
   > Cloudflare asks you to add a payment method to enable R2. You won't be charged within the free 10 GB / month.

## 2. Create an API token (S3 credentials)
1. R2 → **Manage R2 API Tokens** (top-right) → **Create API token**.
2. Permissions: **Object Read & Write**.
3. Scope: **Apply to specific buckets only → `zdr-portal`**.
4. TTL: leave as-is (or a long expiry). **Create API Token**.
5. Copy these three values (shown once):
   - **Access Key ID**
   - **Secret Access Key**
   - **Account ID** (also visible on the R2 overview page / in the S3 endpoint)

## 3. Add a CORS policy to the bucket
The browser uploads directly to R2, so the bucket must allow your site's origin.
1. R2 → your bucket → **Settings** → **CORS policy** → **Add CORS policy**.
2. Paste:
```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://zerodayreapers.me",
      "https://www.zerodayreapers.me"
    ],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```
3. Save. (Add any Vercel preview URLs here too if you want uploads to work on previews.)

## 4. Set environment variables
These are **server-only secrets** — do NOT prefix them with `NEXT_PUBLIC_`.

Local — add to `.env.local`:
```
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET=zdr-portal
```
Vercel — main project → Settings → Environment Variables → add the same four → redeploy.

## 5. Done
That's it. The portal's `/api/r2/*` routes use these to mint presigned URLs.
Storage math: 200 students × ~7 PDFs × ~700 KB ≈ 1 GB → ~10% of the free tier.
You'd fit well over 1,000 students before nearing 10 GB.

### Security model
- R2 keys are `submissions/{userId}/...` and `documents/{userId}/...`.
- The API route verifies the caller's Supabase JWT, then only signs a URL if the
  key is in **their own** folder — or they're an **admin** (admins can read any file).
- Presigned URLs expire in 5 minutes. The bucket is private; there's no public URL.
