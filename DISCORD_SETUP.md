# ZeroDay Reapers — Discord Server Setup

Complete guide to building the ZeroDay Reapers community server, from empty
server to a fully automated flow where applicants who submit the internship
form get placed into their chosen department automatically and see only that
department's channels.

---

## Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Prerequisites](#2-prerequisites)
3. [Phase 1 — Server Creation](#3-phase-1--server-creation)
4. [Phase 2 — Roles](#4-phase-2--roles)
5. [Phase 3 — Categories & Channels](#5-phase-3--categories--channels)
6. [Phase 4 — Permissions](#6-phase-4--permissions)
7. [Phase 5 — Content (rules, welcome, pins, templates)](#7-phase-5--content-rules-welcome-pins-templates)
8. [Phase 6 — Bots](#8-phase-6--bots)
9. [Phase 7 — Auto Department Assignment (Discord Onboarding)](#9-phase-7--auto-department-assignment-discord-onboarding)
10. [Phase 8 — Google Form → Discord Integration](#10-phase-8--google-form--discord-integration)
11. [Phase 9 — Website Integration](#11-phase-9--website-integration)
12. [Phase 10 — Optional: One-Shot Setup Script](#12-phase-10--optional-one-shot-setup-script)
13. [Maintenance & Troubleshooting](#13-maintenance--troubleshooting)

---

## 1. Overview & Architecture

**End-state you're building:**

```
Applicant fills Google Form  ─┐
                              │
                              ▼
              Google Apps Script fires on submit
                              │
                              ▼
   POSTs applicant details (name, email, department, Discord username)
   to a Discord webhook in #applications-review
                              │
                              ▼
   Mentor reviews → sends personal Discord invite (or shares public invite)
                              │
                              ▼
   Applicant joins server → Discord Onboarding wizard appears
                              │
                              ▼
   Applicant confirms their department → auto-assigned @Intern-XX role
                              │
                              ▼
   Only that department's category becomes visible.
   Other 5 departments stay hidden. Cohort role gives cross-dept
   #announcements + #task-submissions.
```

**Why this design:**

- Google Form stays as-is (already in production, linked from website)
- No custom bot required for role assignment — Discord's built-in **Onboarding**
  feature handles it natively
- Webhook is one-way and safe (no bot token exposed anywhere public)
- Mentors keep the accept/reject decision instead of it being fully automatic
  (prevents random Discord users grabbing intern roles by lying about their form)

**Two automation paths in this doc:**

- **Path A (recommended for launch):** Manual server setup + Discord Onboarding
  + Google Apps Script webhook. No custom bot, no code deploys, works forever.
- **Path B (optional):** One-shot Node.js script using `discord.js` that builds
  the entire server structure from scratch in ~30 seconds. Useful if you ever
  want to reset or clone the server for Cohort #2.

---

## 2. Prerequisites

- A Discord account (Ali's personal account will be the owner)
- Admin access to `zerodayreapers.me` Google account (owns the form)
- 45–60 minutes of uninterrupted time for the full setup
- Optional (Path B only): Node.js 18+ installed locally

---

## 3. Phase 1 — Server Creation

### 3.1 Create the server

1. Discord → left sidebar → **`+`** → **Create My Own** → **For a club or community**
2. **Server name:** `ZeroDay Reapers`
3. **Server icon:** upload `public/logo.svg` or `public/logo.png` from the website repo
4. **Region:** leave on auto

### 3.2 Enable Community mode (required for Onboarding)

1. **Server Settings** → **Enable Community**
2. Follow the checklist:
   - Verification: **Medium** (must be a registered Discord user for >5 min)
   - Content filter: **Scan messages from all members**
   - Set a **Rules** channel (temporarily use `#general` — we'll create the real one soon)
   - Set an **Updates** channel (same)
3. Confirm → your server is now a Community Server. This unlocks:
   - Announcement channels
   - Discord Onboarding
   - Server discovery
   - Insights (basic analytics)

### 3.3 Server-wide settings

- **Server Settings → Overview** → set System Messages Channel to `#welcome` (create later)
- **Server Settings → Safety Setup** → enable **AutoMod** with default rules for spam, mention spam, malicious links
- **Server Settings → Widget** → **Enable Server Widget**. Copy the instant-invite URL — we'll paste it into the website later

---

## 4. Phase 2 — Roles

Create roles in this order (top of list = highest priority = most power).

**Server Settings → Roles → Create Role**

| Role name         | Color         | Key permissions                                             | Display separately |
|-------------------|---------------|-------------------------------------------------------------|--------------------|
| `Founder`         | `#e10600`     | Administrator                                               | ✅                 |
| `Mentor`          | Orange        | Manage Messages, Manage Threads, Mention Everyone, Kick     | ✅                 |
| `Bots`            | Purple        | (only what each bot requires — no Admin unless needed)      | ✅                 |
| `Intern-Cohort-1` | White         | Send Messages, Attach Files, Embed Links                    | ❌                 |
| `Intern-OS`       | `#ff4444`     | Same as Cohort-1                                            | ❌                 |
| `Intern-DS`       | `#4488ff`     | Same                                                        | ❌                 |
| `Intern-CS`       | `#44ccff`     | Same                                                        | ❌                 |
| `Intern-GC`       | `#cccc44`     | Same                                                        | ❌                 |
| `Intern-DF`       | `#aa66cc`     | Same                                                        | ❌                 |
| `Intern-AI`       | `#22cc88`     | Same                                                        | ❌                 |
| `Alumni`          | Gold          | Send Messages                                               | ✅                 |
| `Applicant`       | Grey          | Read only in `#welcome`, `#rules`, `#internship-info`        | ❌                 |

**Notes:**

- The department suffixes (`OS`, `DS`, `CS`, `GC`, `DF`, `AI`) will be the exact
  names used by Discord Onboarding — case-sensitive later, so keep them consistent
- `Intern-Cohort-1` is an **umbrella role** — every accepted intern gets this
  plus their department role. It gives them access to the cross-department
  channels like `#announcements` and `#task-submissions`
- `Applicant` is auto-assigned to new joiners so they can see the rules and
  intro channels but nothing else until they either accept the rules or
  complete Onboarding

---

## 5. Phase 3 — Categories & Channels

Create in this exact order. Each channel prefix (`os-`, `ds-`, etc.) matches
the role suffix — makes cross-referencing painless.

```
📢 INFO
    #welcome                 (text)
    #rules                   (text, read-only)
    #announcements           (Announcement channel, read-only)
    #resources               (text, read-only)

💬 COMMUNITY
    #general-chat            (text)
    #introductions           (text)
    #help-desk               (text)
    🔊 General Voice         (voice)

🎯 INTERNSHIP HQ
    #internship-info         (text, read-only)
    #task-submissions        (Forum channel)
    #certificate-claims      (text)

🎯 OFFENSIVE SECURITY        ← category
    #os-announcements        (text, read-only)
    #os-resources            (text, read-only)
    #os-lab-discussions      (text)
    🔊 OS Meeting Room       (voice)

🛡 DEFENSIVE SECURITY
    #ds-announcements
    #ds-resources
    #ds-lab-discussions
    🔊 DS Meeting Room

☁ CLOUD SECURITY
    #cs-announcements
    #cs-resources
    #cs-lab-discussions
    🔊 CS Meeting Room

📋 GOVERNANCE & COMPLIANCE
    #gc-announcements
    #gc-resources
    #gc-lab-discussions
    🔊 GC Meeting Room

🔬 DIGITAL FORENSICS
    #df-announcements
    #df-resources
    #df-lab-discussions
    🔊 DF Meeting Room

🤖 AI SECURITY
    #ai-announcements
    #ai-resources
    #ai-lab-discussions
    🔊 AI Meeting Room

🔒 STAFF (private)
    #mentor-lounge
    #applications-review
    #webhook-firehose
```

**Creating a channel:** hover over the category → **`+`** icon → pick type
(Text / Voice / Announcement / Forum) → name it.

**Channel type notes:**

- **Announcement channel** (`#announcements`, all `#XX-announcements`): behaves
  like text, but other Community servers can follow them and repost your
  messages to their own server. Use for cohort-wide news.
- **Forum channel** (`#task-submissions`): each task submission becomes a
  separate thread. Great for keeping reviews organized without one giant chat
- **Voice channel**: no text overlay by default; enable **Text-in-Voice** in
  channel settings if you want a chat sidebar while in the call

---

## 6. Phase 4 — Permissions

The whole point of the department structure is that **an `@Intern-OS` sees
only Offensive Security, not the other 5**. Here's how to lock that down
cleanly.

### 6.1 Baseline: `@everyone`

Server Settings → Roles → `@everyone` → uncheck:
- View Channels ❌
- Send Messages ❌
- Connect ❌
- Speak ❌

This makes the server invisible to everyone by default. Access is then granted
per-role, per-category. This is the safest permission model.

### 6.2 INFO category

Right-click category **INFO** → **Edit Category** → **Permissions** tab:

| Role             | View | Send |
|------------------|:----:|:----:|
| `@everyone`      | ✅   | ❌   |
| `@Founder`       | ✅   | ✅   |
| `@Mentor`        | ✅   | ✅   |

Everyone can read INFO channels; only staff can post. Then override the two
"conversation-allowed" channels inside:

- `#welcome`: allow no one but the welcome bot (or delete send perms entirely — a bot post is enough)
- `#rules`: read-only for everyone

### 6.3 COMMUNITY category

| Role             | View | Send | Connect | Speak |
|------------------|:----:|:----:|:-------:|:-----:|
| `@everyone`      | ❌   | ❌   | ❌      | ❌    |
| `@Applicant`     | ✅   | ✅   | ✅      | ✅    |
| `@Intern-Cohort-1` | ✅ | ✅   | ✅      | ✅    |
| `@Alumni`        | ✅   | ✅   | ✅      | ✅    |
| `@Mentor`        | ✅   | ✅   | ✅      | ✅    |
| `@Founder`       | ✅   | ✅   | ✅      | ✅    |

### 6.4 INTERNSHIP HQ category

| Role                | View | Send |
|---------------------|:----:|:----:|
| `@everyone`         | ❌   | ❌   |
| `@Intern-Cohort-1`  | ✅   | ✅   |
| `@Mentor`           | ✅   | ✅   |
| `@Founder`          | ✅   | ✅   |

Then override per-channel:
- `#internship-info`: `@everyone` → View ✅, Send ❌ (public info)
- `#task-submissions`: interns can create posts, only mentors can mark
  as "resolved" (Forum tag permissions handled via Discord's built-in
  Forum settings)
- `#certificate-claims`: interns can post, only mentors reply

### 6.5 Department categories (this is the key part)

For each of the 6 department categories, use this permission block. **Change
only the role name** (`@Intern-OS` for Offensive, `@Intern-DS` for Defensive,
etc.).

Example for **OFFENSIVE SECURITY**:

| Role             | View | Send | Connect | Speak |
|------------------|:----:|:----:|:-------:|:-----:|
| `@everyone`      | ❌   | ❌   | ❌      | ❌    |
| `@Intern-OS`     | ✅   | ✅   | ✅      | ✅    |
| `@Mentor`        | ✅   | ✅   | ✅      | ✅    |
| `@Founder`       | ✅   | ✅   | ✅      | ✅    |
| `@Alumni`        | ✅   | ❌   | ✅      | ✅    |

**Result:** an `@Intern-DS` (Defensive intern) opening the server sees only
their own DS category. They can't see OS, CS, GC, DF, or AI at all —
including the category header. The channel list is short and focused.

Then override the two read-only channels inside each department category:
- `#XX-announcements`: `@Intern-XX` → Send ❌
- `#XX-resources`: `@Intern-XX` → Send ❌

⚠ **Do overrides AFTER category sync, not before.** If you click "Sync
permissions to category" later, your overrides get wiped.

### 6.6 STAFF category

| Role             | View | Send |
|------------------|:----:|:----:|
| `@everyone`      | ❌   | ❌   |
| `@Mentor`        | ✅   | ✅   |
| `@Founder`       | ✅   | ✅   |

Only staff sees this category exists.

---

## 7. Phase 5 — Content (rules, welcome, pins, templates)

Paste these directly into the corresponding channel. Discord supports full
Markdown.

### 7.1 `#rules`

```
# ZeroDay Reapers — Server Rules

Welcome to ZeroDay Reapers. Read before you post. Breaking rules gets warnings, then mutes, then bans.

**1. Be respectful.** No harassment, hate speech, racism, sexism, or personal attacks. Disagree with ideas, not people.

**2. English only in public channels.** So mentors can moderate.

**3. Ethical hacking only.** Never share attacks against systems you don't own or have written permission to test. No malware, credential dumps, cracked tools, or piracy. This will get you banned instantly.

**4. No spam / self-promotion.** No unsolicited DMs to members. No dropping links to your own courses, YouTube, or servers without asking a Mentor first.

**5. Stay on topic per channel.** Cloud questions in #cs-lab-discussions, red team in #os-lab-discussions, etc.

**6. Use #help-desk for general help.** Department-specific questions go in your department's #XX-lab-discussions.

**7. NSFW / illegal content = instant ban.**

**8. Doxxing = instant ban.** Never share anyone's personal info without consent.

**9. Interns:** submit tasks only in #task-submissions. Missed deadlines are on you — the 6-week timeline is strict.

**10. Have fun and learn.** This server exists so you get better at the craft.

React ✅ to confirm you've read the rules.
```

Post it, then react to your own message with ✅. MEE6 will use that message +
reaction as the trigger to assign `@Applicant`.

### 7.2 `#welcome`

```
# Welcome to ZeroDay Reapers 🩸

You just entered the offensive security collective founded by **Ali Raza** (CEH Trainer, PNPT, eJPT, Multi-Cloud Red Teaming Analyst).

**What this server is for:**
▸ Learning offensive & defensive security together
▸ Running the ZeroDay Reapers internship program (6 weeks, 6 tasks, 1 cert)
▸ Building a community of hackers, defenders, and lifelong learners

**Start here:**
1. Read <#RULES_CHANNEL_ID> and react ✅ to unlock the server
2. Say hi in <#INTRODUCTIONS_CHANNEL_ID>
3. If you're an accepted intern, complete the Onboarding wizard that pops up — pick your department
4. Browse the channels and get to work

**Website:** https://zerodayreapers.me
**Apply for internship:** https://forms.gle/FmRKkge8aBhq3yZF7
**Contact:** contact@zerodayreapers.me

Stay sharp. Hunt hard. — Reaper HQ
```

Replace `RULES_CHANNEL_ID` and `INTRODUCTIONS_CHANNEL_ID` with real IDs
(right-click a channel → "Copy Link" gives you a full URL you can paste as a
channel mention like `<#12345...>`, or use `#rules` as a fallback).

### 7.3 `#internship-info`

```
# ZeroDay Reapers Internship — Cohort Info

**Duration:** 6 weeks
**Format:** Remote, unpaid
**Structure:** 6 practical, real-world scenarios — one per week
**Outcome:** Internship completion certificate (only if all 6 tasks are submitted on time)

## Departments

Each department has its own home with 4 channels:
📢 announcements · 📚 resources · 💬 lab discussions · 🔊 meeting room

▸ **Offensive Security** — attack chains, exploitation, red team ops
▸ **Defensive Security** — detection engineering, SOC workflows, IR
▸ **Cloud Security** — AWS · Azure · GCP hardening and audits
▸ **Governance & Compliance** — SOC 2, ISO 27001, GDPR mapping
▸ **Digital Forensics** — disk, memory, and network artifact analysis
▸ **AI Security** — LLM red teaming, model integrity, prompt attacks

## How it works

1. Apply → https://forms.gle/FmRKkge8aBhq3yZF7
2. If accepted, you'll receive a Discord invite from a Mentor
3. On joining, Discord's Onboarding wizard will ask which department you applied to. Pick the same one you selected in the form.
4. You'll be auto-assigned `@Intern-Cohort-1` + your department role
5. Tasks drop weekly in <#TASK_SUBMISSIONS_CHANNEL_ID>
6. Submit your work as a Forum post under your department's tag
7. Complete all 6 on schedule → drop a request in <#CERTIFICATE_CLAIMS_CHANNEL_ID>

## Rules

- Deadlines are firm. One missed task = no certificate.
- Work must be original. Plagiarism = removal from cohort.
- Ask department-specific questions in your department's #XX-lab-discussions.
- Ping `@Mentor` in <#HELP_DESK_CHANNEL_ID> for general help.

Questions? Post in <#HELP_DESK_CHANNEL_ID>.
```

### 7.4 Per-department `#XX-announcements` pin

Template — customize the XX and department name for each of the 6 depts:

```
# XX — Department Home

You've been assigned to the **[Full Department Name]** department for Cohort #1.

**Channels here:**
▸ #xx-announcements — task drops, deadlines, mentor updates (read-only)
▸ #xx-resources — cheatsheets, tools, papers (read-only, curated by mentors)
▸ #xx-lab-discussions — chat, help each other, share write-ups
▸ 🔊 XX Meeting Room — office hours, group sessions, pair-work

**Rules:**
▸ Task submissions still go to <#TASK_SUBMISSIONS_CHANNEL_ID> — not here
▸ Ping @Mentor in #xx-lab-discussions for department-specific help
▸ Voice room is open 24/7 — feel free to jump in and work together

Task 1 drops in this channel next week. Stay ready.
```

### 7.5 Per-department `#XX-resources` starter posts

**#os-resources (Offensive)**
```
# Offensive Security — Starter Resources

**Practice platforms**
▸ HackTheBox — https://hackthebox.com
▸ TryHackMe — https://tryhackme.com
▸ PortSwigger Web Academy — https://portswigger.net/web-security

**References**
▸ PayloadsAllTheThings — https://github.com/swisskyrepo/PayloadsAllTheThings
▸ HackTricks — https://book.hacktricks.wiki
▸ OWASP Top 10 (2021) — https://owasp.org/Top10

**Tooling**
▸ Burp Suite Community, nmap, ffuf, sqlmap, John the Ripper, hashcat

Mentors will drop task-specific resources here as the cohort progresses.
```

**#ds-resources (Defensive)**
```
# Defensive Security — Starter Resources

**Practice / labs**
▸ Blue Team Labs Online — https://blueteamlabs.online
▸ LetsDefend — https://letsdefend.io
▸ CyberDefenders — https://cyberdefenders.org

**References**
▸ MITRE ATT&CK — https://attack.mitre.org
▸ Sigma Rules — https://github.com/SigmaHQ/sigma
▸ Elastic SIEM docs — https://www.elastic.co/guide/en/security

**Tooling**
▸ Elastic Security, Wazuh, TheHive, Velociraptor
```

**#cs-resources (Cloud)**
```
# Cloud Security — Starter Resources

**Practice**
▸ flaws.cloud + flaws2.cloud — https://flaws.cloud
▸ CloudGoat (AWS) — https://github.com/RhinoSecurityLabs/cloudgoat
▸ Azure Goat — https://github.com/ine-labs/AzureGoat
▸ GCPGoat — https://github.com/ine-labs/GCPGoat

**References**
▸ HackTricks Cloud — https://cloud.hacktricks.wiki
▸ AWS Well-Architected Security Pillar
▸ Microsoft Cloud Security Benchmark

**Tooling**
▸ Prowler, ScoutSuite, PMapper, Pacu (AWS)
```

**#gc-resources (Governance & Compliance)**
```
# Governance & Compliance — Starter Resources

**Frameworks**
▸ SOC 2 Trust Services Criteria — https://www.aicpa.org
▸ ISO/IEC 27001:2022 controls
▸ GDPR full text — https://gdpr-info.eu
▸ CIS Controls v8 — https://www.cisecurity.org/controls
▸ NIST CSF 2.0 — https://www.nist.gov/cyberframework

**Templates**
▸ SANS security policy templates — https://www.sans.org/information-security-policy

**Tooling**
▸ Vanta, Drata (SaaS compliance automation — good to know even if not used)
```

**#df-resources (Digital Forensics)**
```
# Digital Forensics — Starter Resources

**Practice / images**
▸ DFIR.training — https://www.dfir.training
▸ Belkasoft sample disk images
▸ Digital Corpora — https://digitalcorpora.org

**References**
▸ SANS DFIR posters
▸ Windows Forensic Analysis by Harlan Carvey
▸ The Art of Memory Forensics

**Tooling**
▸ Autopsy, FTK Imager, Volatility 3, plaso/log2timeline, KAPE
```

**#ai-resources (AI Security)**
```
# AI Security — Starter Resources

**References**
▸ OWASP LLM Top 10 — https://owasp.org/www-project-top-10-for-large-language-model-applications
▸ MITRE ATLAS — https://atlas.mitre.org
▸ Anthropic red-team papers — https://www.anthropic.com/research
▸ HackAPrompt writeups — https://www.hackaprompt.com

**Practice**
▸ Gandalf (Lakera) — https://gandalf.lakera.ai
▸ PortSwigger LLM labs — https://portswigger.net/web-security/llm-attacks

**Tooling**
▸ garak (LLM vuln scanner), PyRIT, promptfoo
```

### 7.6 Announcement templates

Draft these into a personal notes doc — post when the moment comes.

**Applications open:**
```
📣 **Cohort #1 applications now open**

We're accepting the first batch of ZeroDay Reapers interns.

⏳ Applications close: [DATE]
🎯 Slots: [NUMBER] across 6 departments
📝 Apply: https://forms.gle/FmRKkge8aBhq3yZF7

Read the full details in <#INTERNSHIP_INFO_CHANNEL_ID>.
```

**Cohort start:**
```
🚀 **Cohort #1 kickoff — [DATE]**

Welcome to the [NUMBER] new interns who just got the `@Intern-Cohort-1` role.
Head to your department channel and check <#TASK_SUBMISSIONS_CHANNEL_ID> —
Task 1 drops today at [TIME].

Deadline for Task 1: [DATE + 7 days]. No extensions.

Good hunting.
```

**Weekly task drop:**
```
🎯 **Week [N] task is live**

Head to <#TASK_SUBMISSIONS_CHANNEL_ID> → your department tag → the pinned post.

**Deadline:** [DATE], 23:59 UTC
**Format:** Reply to the post with a write-up + any supporting files
**Mentors reviewing:** [names]

Questions in your department channel or <#HELP_DESK_CHANNEL_ID>.
```

**Certificate ceremony:**
```
🏆 **Cohort #1 — Certificates awarded**

Congratulations to the [N] interns who completed all 6 tasks on time. Your
certificates have been sent to the email you used to apply.

You've been moved from `@Intern-Cohort-1` to `@Alumni` — you keep access to
your department for lifelong reference.

Cohort #2 opens on [DATE]. Watch this channel.
```

---

## 8. Phase 6 — Bots

Install the bots you actually need. Don't bulk-install — every bot is a
permission surface.

### 8.1 MEE6 (required)

Handles auto-role, welcome, rules-reaction, and basic moderation.

**Install:** https://mee6.xyz → **Add to Discord** → pick `ZeroDay Reapers`

**Configure via MEE6 dashboard (https://mee6.xyz/dashboard):**

1. **Welcome plugin** → enable → channel `#welcome` → message:
   ```
   Welcome {user} to ZeroDay Reapers 🩸
   Please read <#RULES_CHANNEL_ID> and react ✅ to unlock the server.
   ```
2. **Reaction roles** → target message = your `#rules` post → emoji ✅ →
   role `@Applicant`
3. **Auto-role** → *leave disabled* (Applicant role should require rules
   acknowledgment, not auto-assign)
4. **Moderator** plugin → enable → configure spam, mass-mention,
   invite-link, and excessive-caps filters
5. **Logs** plugin → enable → channel `#mentor-lounge` → log
   joins/leaves/bans/message edits

### 8.2 Sesh (recommended)

Event scheduling and RSVPs — useful for weekly office hours and cohort
deadlines.

**Install:** https://sesh.fyi → **Add to Discord**

**Usage:**
- Type `/event` in any channel to create an event with RSVP buttons
- Sesh auto-creates a reminder message 24h before
- Great for "Task 1 review call — Tue 8pm UTC"

### 8.3 GitHub bot (optional)

Post repo events into a `#dev-log` channel.

**Install:** repo → Settings → **Integrations** → **GitHub app for Discord**
- Or use Discord webhook: create webhook in `#dev-log` → GitHub repo →
  Webhooks → Add webhook → paste Discord URL with `/github` suffix

### 8.4 Carl-bot / YAGPDB (skip unless MEE6 hits a limit)

More powerful than MEE6 but adds cognitive overhead. Only reach for these if
you need custom slash commands, complex autoresponders, or the paid
MEE6 tier costs get annoying.

---

## 9. Phase 7 — Auto Department Assignment (Discord Onboarding)

This is the **fully automated department-role assignment** using Discord's
built-in Onboarding — no bot code needed.

### 9.1 Requirements

- Community Server (enabled in Phase 1) ✅
- Roles created (`@Intern-OS`, `@Intern-DS`, etc.) ✅
- Department categories with proper permissions ✅
- At least 7 channels visible to `@everyone` (Discord requires this for
  Onboarding to activate — the INFO category alone satisfies this)

### 9.2 Configure Onboarding

**Server Settings → Onboarding**

1. **Default Channels** — pick channels a new joiner should see immediately:
   - `#welcome`
   - `#rules`
   - `#internship-info`
   - `#introductions`

2. **Customize Your Discord (question step)** — this is where department
   selection happens. Click **Add Question**.

   **Question:** "Which department did you apply to?"
   **Question type:** Single-select (radio, not checkboxes)
   **Answers (one per row):**

   | Answer label                | Emoji | Description                      | Roles assigned |
   |-----------------------------|-------|----------------------------------|----------------|
   | Offensive Security          | 🎯    | Attack chains, exploitation      | `Intern-OS`, `Intern-Cohort-1` |
   | Defensive Security          | 🛡    | Detection, SOC, IR               | `Intern-DS`, `Intern-Cohort-1` |
   | Cloud Security              | ☁     | AWS · Azure · GCP                | `Intern-CS`, `Intern-Cohort-1` |
   | Governance & Compliance     | 📋    | SOC 2, ISO 27001, GDPR           | `Intern-GC`, `Intern-Cohort-1` |
   | Digital Forensics           | 🔬    | Disk, memory, network artifacts  | `Intern-DF`, `Intern-Cohort-1` |
   | AI Security                 | 🤖    | LLM red teaming, model integrity | `Intern-AI`, `Intern-Cohort-1` |
   | Just visiting (not enrolled) | 👀    | Community access only            | (none — Applicant stays) |

3. Save → enable Onboarding.

### 9.3 What the new-user experience looks like

1. Applicant clicks the invite link
2. Joins server — sees only Default Channels (INFO + Introductions)
3. Onboarding wizard pops up
4. Applicant picks their department → Discord auto-assigns the intern roles
5. Category permissions kick in: OS intern now sees `#os-*` channels; DS, CS,
   GC, DF, AI stay hidden

### 9.4 Preventing abuse (people picking wrong dept)

**Problem:** anyone with the invite link could pick "Offensive Security" and
get access even if they applied for Cloud.

**Two safeguards:**

1. **Mentors verify against Google Form on entry** — mentor sees join in
   `#mentor-lounge` (MEE6 join log) → checks form response in
   `#applications-review` → if mismatch, kicks + re-invites with a note
2. **Weekly audit** — one mentor runs `/members` filter by role once a week
   and compares against the form spreadsheet. Anyone with a role they didn't
   apply for gets removed

For Cohort #1 with a small number of interns, manual verification is fine.
Automation for this (verifying Discord user against form email) requires the
Path B custom bot in Phase 12.

---

## 10. Phase 8 — Google Form → Discord Integration

Post every new form submission into `#applications-review` so mentors see
applicants without checking the spreadsheet.

### 10.1 Create the Discord webhook

1. In Discord: right-click `#applications-review` → **Edit Channel** →
   **Integrations** → **Webhooks** → **New Webhook**
2. Name: `Form Bot`
3. Copy the **Webhook URL** — treat like a password, don't commit it anywhere
   public
4. Save

### 10.2 Wire up the Google Form via Apps Script

1. Open the Google Form → click ⋮ (top right) → **Script editor**
   (or: form's linked Google Sheet → Extensions → Apps Script)
2. Paste this code (replace `WEBHOOK_URL` with the one you just copied):

```javascript
// Runs every time the form is submitted.
function onFormSubmit(e) {
  const WEBHOOK_URL = 'PASTE_YOUR_DISCORD_WEBHOOK_URL_HERE';

  // e.namedValues is a {questionTitle: [answer]} object
  const v = e.namedValues;
  const name       = (v['Name'] || v['Full Name'] || [''])[0];
  const email      = (v['Email'] || v['Email Address'] || [''])[0];
  const department = (v['Department'] || v['Which department?'] || [''])[0];
  const discord    = (v['Discord Username'] || v['Discord Tag'] || [''])[0];
  const experience = (v['Experience'] || v['Background'] || [''])[0];
  const motivation = (v['Motivation'] || v['Why this program?'] || [''])[0];

  const embed = {
    title: '🎯 New Internship Application',
    color: 0xe10600, // blood red
    fields: [
      { name: 'Name',       value: name       || '—', inline: true  },
      { name: 'Email',      value: email      || '—', inline: true  },
      { name: 'Department', value: department || '—', inline: false },
      { name: 'Discord',    value: discord    || '—', inline: true  },
      { name: 'Experience', value: (experience || '—').slice(0, 1024), inline: false },
      { name: 'Motivation', value: (motivation || '—').slice(0, 1024), inline: false },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'ZeroDay Reapers Internship Form' },
  };

  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ embeds: [embed] }),
  });
}
```

3. **Field name matching:** change the strings on the left of `||` to match
   the exact question titles in your form (case-sensitive). To see the exact
   names, submit a test entry, then in Apps Script go to **Executions** →
   look at `e.namedValues` in the log.
4. **File → Save**

### 10.3 Install the trigger

1. Apps Script → left sidebar → ⏰ **Triggers** → **Add Trigger**
2. Function: `onFormSubmit`
3. Event source: **From form**
4. Event type: **On form submit**
5. Save → Google will ask for permissions the first time (accept — it's your
   own script)

### 10.4 Test end-to-end

1. Submit a test entry in the form
2. Watch `#applications-review` — the embed should appear within a few seconds
3. If nothing shows up: Apps Script → **Executions** → find the failed run →
   read the error (usually a webhook URL typo or a field-name mismatch)

### 10.5 What mentors do with each submission

1. See the embed in `#applications-review`
2. Verify the applicant is credible (LinkedIn, GitHub, quick chat)
3. Decide accept / reject
4. If accepted: DM applicant your permanent Discord invite → applicant joins →
   picks their department in Onboarding → auto-role assigned
5. If rejected: reply with a short note via email

### 10.6 Add "Discord username" to the form

If your form doesn't already ask, add a **Short answer** question:
`Discord username (optional — for cohort acceptance)`. Applicants who leave
it blank get emailed the invite. Ones who fill it get contacted on Discord
faster.

---

## 11. Phase 9 — Website Integration

Once your permanent Discord invite exists, wire it into the site:

1. Server Settings → Widget → copy the Instant Invite URL (make sure
   "Never Expire" and "Max Uses = No limit" are set)
2. Send the URL to the site owner → they'll:
   - Add a "Discord" link in the nav (between "Team" and "Contact")
   - Add a Discord line to the Contact section
   - Optionally add a "Join the community" CTA card between Internships and About

For webhook-based site → Discord notifications on the contact form: Web3Forms
Pro tier supports webhook forwarding. Alternative — set up a second Google
Form for "Contact us" and use the same Apps Script pattern from Phase 8.

---

## 12. Phase 10 — Optional: One-Shot Setup Script

If you want to skip the manual Phase 3–5 grind (or rebuild for Cohort #2),
here's the bot-driven path.

### 12.1 Create a Discord bot

1. Go to https://discord.com/developers/applications → **New Application** →
   name it `ZDR Setup Bot`
2. **Bot** tab → **Reset Token** → copy the token (treat as a secret)
3. Toggle these **Privileged Gateway Intents**: MESSAGE CONTENT (leave the
   others off)
4. **OAuth2 → URL Generator** → scope `bot` → permission `Administrator` →
   copy the generated URL → open it → select your server → authorize

### 12.2 Local project

```bash
mkdir zdr-discord-setup
cd zdr-discord-setup
npm init -y
npm install discord.js@14 dotenv
```

Create `.env` in that folder (DO NOT COMMIT):
```
DISCORD_TOKEN=your_bot_token_here
GUILD_ID=your_server_id_here
```

Get your `GUILD_ID`: Discord → User Settings → Advanced → enable Developer
Mode → right-click server icon → Copy Server ID.

### 12.3 The setup script

Create `setup.js`:

```javascript
require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const DEPARTMENTS = [
  { prefix: 'os', name: 'OFFENSIVE SECURITY', emoji: '🎯', roleName: 'Intern-OS', color: 0xff4444 },
  { prefix: 'ds', name: 'DEFENSIVE SECURITY', emoji: '🛡', roleName: 'Intern-DS', color: 0x4488ff },
  { prefix: 'cs', name: 'CLOUD SECURITY',    emoji: '☁', roleName: 'Intern-CS', color: 0x44ccff },
  { prefix: 'gc', name: 'GOVERNANCE & COMPLIANCE', emoji: '📋', roleName: 'Intern-GC', color: 0xcccc44 },
  { prefix: 'df', name: 'DIGITAL FORENSICS', emoji: '🔬', roleName: 'Intern-DF', color: 0xaa66cc },
  { prefix: 'ai', name: 'AI SECURITY',       emoji: '🤖', roleName: 'Intern-AI', color: 0x22cc88 },
];

const SUB_CHANNELS = ['announcements', 'resources', 'lab-discussions'];

client.once('ready', async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);

  console.log('Creating shared roles...');
  const founder = await ensureRole(guild, 'Founder',         { color: 0xe10600, permissions: [PermissionFlagsBits.Administrator], hoist: true });
  const mentor  = await ensureRole(guild, 'Mentor',          { color: 0xff9900, hoist: true });
  const cohort  = await ensureRole(guild, 'Intern-Cohort-1', { color: 0xffffff });
  const alumni  = await ensureRole(guild, 'Alumni',          { color: 0xffd700, hoist: true });
  const applicant = await ensureRole(guild, 'Applicant',     { color: 0x888888 });

  console.log('Creating INFO / COMMUNITY / INTERNSHIP HQ categories...');
  await ensureCategory(guild, '📢 INFO', ['welcome', 'rules', 'announcements', 'resources']);
  await ensureCategory(guild, '💬 COMMUNITY', ['general-chat', 'introductions', 'help-desk']);
  await ensureCategory(guild, '🎯 INTERNSHIP HQ', ['internship-info', 'task-submissions', 'certificate-claims']);

  console.log('Creating department categories, channels, and per-dept roles...');
  for (const dept of DEPARTMENTS) {
    const role = await ensureRole(guild, dept.roleName, { color: dept.color });

    const cat = await guild.channels.create({
      name: `${dept.emoji} ${dept.name}`,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.roles.everyone,        deny:  [PermissionFlagsBits.ViewChannel] },
        { id: role.id,                     allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
        { id: mentor.id,                   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
        { id: founder.id,                  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
      ],
    });

    for (const sub of SUB_CHANNELS) {
      await guild.channels.create({
        name: `${dept.prefix}-${sub}`,
        type: ChannelType.GuildText,
        parent: cat.id,
      });
    }
    await guild.channels.create({
      name: `${dept.prefix.toUpperCase()} Meeting Room`,
      type: ChannelType.GuildVoice,
      parent: cat.id,
    });
    console.log(`  ✓ ${dept.name}`);
  }

  console.log('Done. Exiting.');
  process.exit(0);
});

async function ensureRole(guild, name, options = {}) {
  const existing = guild.roles.cache.find(r => r.name === name);
  if (existing) return existing;
  return guild.roles.create({ name, ...options });
}

async function ensureCategory(guild, name, channelNames) {
  const cat = await guild.channels.create({ name, type: ChannelType.GuildCategory });
  for (const chName of channelNames) {
    await guild.channels.create({ name: chName, type: ChannelType.GuildText, parent: cat.id });
  }
  return cat;
}

client.login(process.env.DISCORD_TOKEN);
```

### 12.4 Run it

```bash
node setup.js
```

Takes about 30 seconds. Your server is now fully built: 6 dept categories,
24 dept channels, 6 intern roles + shared roles + INFO/COMMUNITY/INTERNSHIP HQ.

### 12.5 Post-script cleanup

- Delete the bot from the server (Server Settings → Integrations → remove
  the bot)
- Delete or regenerate the bot token at https://discord.com/developers
- Keep the `setup.js` file in a private folder or private GitHub repo. Never
  commit `.env`.

### 12.6 What the script does NOT do

- Discord Onboarding config (must be done in the UI — no public API)
- Bot installations (MEE6, Sesh — manual)
- Enable Community Server (must be UI)
- Post pinned messages with real channel IDs (script would need a second
  pass to know the IDs). Easier to paste manually from Phase 5.

---

## 13. Maintenance & Troubleshooting

### Cohort rollover

When Cohort #1 finishes and you're starting Cohort #2:

1. Bulk-move all `@Intern-Cohort-1` members to `@Alumni`
   (Server Settings → Members → filter by role → bulk-select → change role)
2. Rename `@Intern-Cohort-1` → `@Intern-Cohort-2`
3. Onboarding wizard doesn't need changes — the department roles are reused

### Common issues

| Symptom                                              | Cause                                                         | Fix                                                                                     |
|------------------------------------------------------|---------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| New joiner sees all departments                      | `@everyone` still has "View Channel" allowed                  | Server Settings → Roles → `@everyone` → deny View Channel                                |
| Intern with correct role can't see their department  | Channel-level override contradicts category                   | Right-click category → "Sync permissions" (WARNING: wipes per-channel overrides)         |
| Onboarding wizard doesn't appear for new joiners     | Community mode not fully enabled, or Onboarding not saved      | Server Settings → Onboarding → verify "Enabled" toggle + at least one question saved     |
| Google Form webhook returns 401                      | Wrong webhook URL, or Discord regenerated it                  | Recreate webhook in `#applications-review`, update URL in Apps Script                    |
| Google Form webhook fires but embed is empty         | Field names in Apps Script don't match form question titles   | Executions log → inspect `e.namedValues` → update strings on left of `||` in script      |
| MEE6 doesn't assign role on ✅ reaction              | Reaction Role was set on the wrong message, or bot lost perms | MEE6 dashboard → Reaction Roles → re-link to your `#rules` post                          |
| Discord invite is expiring even though marked forever | Widget-generated invites default to 7 days                    | Manually create invite: right-click server → Invite People → Edit → Never Expire         |

### Backup

Discord has no built-in server export. Snapshot your setup by:
- Running the Path B script (it's declarative — re-running rebuilds identically)
- Screenshotting Server Settings pages (roles, onboarding, channel list)
- Exporting the Google Form responses to Google Sheets weekly (Form → Responses → three-dot menu → Get email notifications + link to Sheets)

### Security hygiene

- Never share the bot token or webhook URL in public channels, tweets, or
  screenshots
- Rotate the bot token immediately if it's ever exposed
- Audit `@Mentor` and `@Founder` membership monthly
- Review MEE6 permissions annually — remove permissions the bot no longer
  needs
- Enable 2FA on all Mentor and Founder accounts (Server Settings → Safety
  Setup → Require 2FA for moderation)

---

## Summary — Order of Operations

For a fresh setup, execute in this order:

1. Phase 1 — Create server, enable Community
2. Phase 2 — Create all roles
3. Phase 3 — Create categories & channels (or run the Path B script for
   phases 2 + 3 combined)
4. Phase 4 — Set permissions
5. Phase 5 — Post content (rules, welcome, department pins)
6. Phase 6 — Install MEE6, configure rules-reaction & welcome
7. Phase 7 — Enable Discord Onboarding, add department question
8. Phase 8 — Create Discord webhook, wire Google Form Apps Script
9. Phase 9 — Send the invite URL to the website owner
10. Phase 10 — (Optional) run bot script instead of manual Phases 2–3

Total time end-to-end: **~1 hour manual, ~30 min automated**.
