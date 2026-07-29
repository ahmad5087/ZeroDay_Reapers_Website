// Google Classroom join links, keyed by domain `key` (from public.domains) and RAM tier.
// Shown on signup once a student picks their Department + RAM. Source of truth:
// "ZeroDay Reapers Google Classroom Link.txt". Update a value here if a classroom is recreated.
export const CLASSROOM_LINKS = {
  offensive: {
    "8GB": "https://classroom.google.com/c/ODcxMjM5MjE5NzMz?cjc=nfl77hld",
    "16GB": "https://classroom.google.com/c/ODcxMjI3NzQ4MzUx?cjc=ree6tmjx",
    "24GB": "https://classroom.google.com/c/ODcxMjM5NjY5NDAz?cjc=b2vb6brc",
  },
  defensive: {
    "8GB": "https://classroom.google.com/c/ODcxMjM4ODEwNzY0?cjc=4ac2o7cw",
    "16GB": "https://classroom.google.com/c/ODcxMjM4NDk0OTc0?cjc=5byagr6z",
    "24GB": "https://classroom.google.com/c/ODcxMjM5OTI4Nzk4?cjc=gudazokn",
  },
  cloud: {
    "8GB": "https://classroom.google.com/c/ODcxMjM5MTY5NjA4?cjc=pjozyu7s",
    "16GB": "https://classroom.google.com/c/ODcxMjM5NjA2MzYw?cjc=353etbpo",
    "24GB": "https://classroom.google.com/c/ODcxMjM5NjM0NzAx?cjc=mq7yukjr",
  },
  ai: {
    "8GB": "https://classroom.google.com/c/ODcxMjM5NDc3Nzc4?cjc=bkgn3hau",
    "16GB": "https://classroom.google.com/c/ODcxMjM5MzI2Nzcz?cjc=h5pehbrg",
    "24GB": "https://classroom.google.com/c/ODcxMjM5OTkxOTM5?cjc=uemixu42",
  },
  grc: {
    "8GB": "https://classroom.google.com/c/ODcxMjM5NTg3Mjg0?cjc=b2i6arkv",
    "16GB": "https://classroom.google.com/c/ODcxMjM5MTM1NTI0?cjc=dt4us6rz",
    "24GB": "https://classroom.google.com/c/ODcxMjM5ODY2MTg0?cjc=46fhel5w",
  },
  forensics: {
    "8GB": "https://classroom.google.com/c/ODcxMjQwMDI4MTA2?cjc=vbgkr35s",
    "16GB": "https://classroom.google.com/c/ODcxMjM5NzExNzkz?cjc=qqdwrw4a",
    "24GB": "https://classroom.google.com/c/ODcxMjM5NTMxMzU0?cjc=4btpwqjg",
  },
};

// Discord community invite — honor-mode fallback shown when OAuth auto-join isn't configured
// (i.e. NEXT_PUBLIC_DISCORD_CLIENT_ID is unset). Override via env if the invite changes.
export const DISCORD_INVITE =
  process.env.NEXT_PUBLIC_DISCORD_INVITE || "https://discord.com/invite/JATEvx9FED";

// Look up the Classroom link for a domain key + RAM tier. Returns null if none exists.
export function classroomLinkFor(domainKey, ram) {
  return CLASSROOM_LINKS[domainKey]?.[ram] || null;
}
