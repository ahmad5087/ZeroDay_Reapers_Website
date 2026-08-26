// Discord webhook notifier for Cohort 2 applications (Phase 12). Env-gated: with
// DISCORD_COHORT_WEBHOOK_URL unset, every send is a no-op, so the app is unaffected until you create the
// webhook (in the #cohort-2-registration channel: Channel settings → Integrations → Webhooks → New Webhook
// → Copy URL) and set the env var. Rotating the webhook = just change the env var; no code change.

const WEBHOOK = process.env.DISCORD_COHORT_WEBHOOK_URL;
const BLOOD = 0xe10600; // brand red — the embed's left bar
// Same logo the website uses, as a public absolute URL. Discord embed thumbnails don't render SVG, so we
// point at the raster /logo.png (identical mark). Override the host via NEXT_PUBLIC_SITE_URL if needed.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://zerodayreapers.me").replace(/\/+$/, "");
const LOGO_URL = `${SITE_URL}/logo.png`;

export function discordConfigured() { return !!WEBHOOK; }

function trunc(v, n) {
  const s = String(v ?? "").trim();
  if (!s) return "—";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Build + POST a rich embed for one Cohort 2 application. Best-effort, never throws.
export async function sendCohortApplicationToDiscord(app) {
  if (!WEBHOOK || !app) return { ok: false, skipped: true };

  const statusLine =
    app.current_status === "Student"
      ? `Student — ${trunc(app.college, 100)}${app.study_year ? ` (${trunc(app.study_year, 40)})` : ""}`
      : trunc(app.current_status, 100);

  const location = [app.city, app.country].filter(Boolean).join(", ");

  const fields = [
    { name: "👤 Name", value: trunc(app.name, 200), inline: true },
    { name: "🎚️ Level", value: trunc(app.experience, 60), inline: true },
    { name: "🚻 Gender", value: trunc(app.gender, 40), inline: true },
    { name: "📧 Email", value: trunc(app.email, 300), inline: true },
    { name: "📱 WhatsApp", value: trunc(app.phone, 60), inline: true },
    { name: "💻 RAM", value: app.ram ? `${trunc(app.ram, 8)} GB` : "—", inline: true },
    { name: "🌍 Location", value: trunc(location, 200), inline: true },
    { name: "🎓 Status", value: trunc(statusLine, 300), inline: true },
    { name: "🤝 Referred by", value: app.referral_code ? trunc(app.referral_code, 60) : "—", inline: true },
    { name: "🔗 LinkedIn", value: trunc(app.linkedin_url, 400), inline: false },
    { name: "📝 Motivation", value: trunc(app.motivation, 1000), inline: false },
  ];

  const body = {
    username: "Cohort 2 Registrations",
    embeds: [
      {
        title: `🎯 Internship Application — ${trunc(app.domain, 180)}`,
        color: BLOOD,
        thumbnail: { url: LOGO_URL },
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: "ZeroDay Reapers · Cohort 2", icon_url: LOGO_URL },
      },
    ],
    // Never let free-text @mentions ping anyone.
    allowed_mentions: { parse: [] },
  };

  try {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
