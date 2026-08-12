// Per-department, per-RAM-tier 6-week mission tracks, transcribed from the department teaser cards
// ("<n>-<Dept>-Teasers"). Keyed by the domain key (see supabase/schema.sql domains seed) then RAM tier
// ('8GB' | '16GB' | '24GB'). Each entry is [missionName, oneLineFocus]. The Learning Path uses these
// names/focus verbatim so the roadmap mirrors the real curriculum a student was placed into.

const TRACKS = {
  offensive: {
    name: "Offensive Security",
    "8GB": [
      ["Break the Login", "Deploy a live vulnerable app and walk past its admin gate."],
      ["The Hidden Network", "One foothold. A network you can't even see. Tunnel your way in."],
      ["Crown the Domain", "From nobody to Domain Admin. Kerberos won't save them."],
      ["Ghost in the Logs", "Strike a machine, then learn exactly what the defender saw."],
      ["Secrets in the Code", "Someone left the keys inside the repo. Go dig them out."],
      ["Zero to Root", "One box. No hints. Own it completely."],
    ],
    "16GB": [
      ["The Arsenal", "Multiple vulnerable apps, one Kali, one full attack chain."],
      ["Double Pivot", "Two hosts, one tunnel, deeper into hostile territory."],
      ["The Misconfigured Kingdom", "A real Active Directory lab on your own machine. Break it."],
      ["Attack & Detect", "Fire live ATT&CK techniques, then hunt your own footprints."],
      ["The Dashboard of Sins", "Every code flaw in one place. Triage the carnage."],
      ["Offline Conquest", "A boot-to-root machine, fully offline, entirely yours."],
    ],
    "24GB": [
      ["Full-Scope Assault", "A whole stack of vulnerable apps under one assessment."],
      ["Triple Hop", "DMZ to internal to database. Chain the pivots."],
      ["GOAD: The Forest", "A multi-DC Active Directory forest. The real deal."],
      ["Live Purple Range", "Attack, forward the logs, detect. The full loop."],
      ["The Secure Pipeline", "Build a DevSecOps gate that stops bad code cold."],
      ["The Range", "Your own multi-machine red-team range. Breach all of it."],
    ],
  },
  defensive: {
    name: "Defensive Security",
    "8GB": [
      ["Follow the Intruder", "An attacker moved through these logs. Trace every step."],
      ["Detonate the Bait", "A malicious email, a safe sandbox. Watch it explode."],
      ["Catch the Payload", "Real malware traffic. Pinpoint the exact moment of infection."],
      ["Hunt the Host", "Interrogate a live machine like a detective chasing persistence."],
      ["The Trap", "Plant a decoy and catch an attacker red-handed."],
      ["Ransomware Response", "A live alert. The clock is ticking. Contain it."],
    ],
    "16GB": [
      ["Boss of the SOC", "A full-scale incident dataset in a real SIEM. Solve the whole thing."],
      ["The Analysis Lab", "Dissect a live sample inside your own malware lab."],
      ["Zeek Vision", "See network attacks the way the pros do."],
      ["Fleet Hunter", "Hunt threats across endpoints with real DFIR tooling."],
      ["The Honeypot", "Lure an attacker into a fake service and study their every move."],
      ["Timeline of an Attack", "Build a super-timeline and tell the whole story."],
    ],
    "24GB": [
      ["Build the SIEM", "Stand up a full detection pipeline from scratch."],
      ["The Detonation Chamber", "Paired analysis VMs, live malware, full IOCs."],
      ["Security Onion", "Full network security monitoring at enterprise scale."],
      ["The Fleet", "Hunt across an entire endpoint estate at once."],
      ["The Honeynet", "A multi-honeypot platform mapping every attacker move."],
      ["Full IR Simulation", "Live intrusion. Detect, respond, report. Everything."],
    ],
  },
  cloud: {
    name: "Cloud Security",
    "8GB": [
      ["The Open Bucket", "A cloud left its doors wide open. Walk right in."],
      ["Attacker & Defender", "Break the cloud, then learn how you'd have been caught."],
      ["Scan the Blueprint", "Find the flaws in the cloud before it's ever built."],
      ["Steal the Metadata", "Trick a server into handing over its own keys."],
      ["The Trail", "One login without MFA. Find it in a sea of logs."],
      ["Build it Right", "Architect a secure cloud, and prove it, at zero cost."],
    ],
    "16GB": [
      ["Cloud in a Box", "Run AWS on your own laptop and break it."],
      ["Kubernetes Goat", "A cluster built to be hacked. Hack it, then fix it."],
      ["The Pipeline Gate", "Catch insecure infrastructure before it ships."],
      ["Serverless SSRF", "Exploit a function and steal its credentials."],
      ["Cloud Logs in a SIEM", "Hunt an attacker through the cloud trails."],
      ["Deploy & Defend", "Stand up cloud infra locally and harden it."],
    ],
    "24GB": [
      ["The Attack Chain", "A full cloud privilege-escalation, offline and free."],
      ["Runtime Defense", "Attack Kubernetes while Falco watches your every move."],
      ["The Merge Gate", "A pipeline that blocks insecure cloud at the door."],
      ["Serverless Lab", "A full API + Lambda attack chain."],
      ["Cloud SIEM", "Build cloud threat detection end to end."],
      ["Policy as Code", "Guardrails that auto-reject insecure infrastructure."],
    ],
  },
  grc: {
    name: "Governance, Risk & Compliance",
    "8GB": [
      ["Rank the Risks", "Turn a messy network into a scored, prioritized risk register."],
      ["The Audit", "Put a real system on trial against ISO 27001."],
      ["The Vendor Verdict", "Build a tool that decides who you can trust."],
      ["Model the Threats", "Map how an app could be attacked, before it is."],
      ["The War Game", "Run a live incident tabletop and write the after-action report."],
      ["Compliance as Code", "Make a machine prove its own compliance."],
    ],
    "16GB": [
      ["Quantify the Risk", "Put real money numbers on cyber risk (FAIR)."],
      ["The Scanner's Verdict", "Audit a live machine against CIS, automatically."],
      ["Run the Program", "Operate a real GRC platform end to end."],
      ["STRIDE", "Threat-model a live app you deployed yourself."],
      ["Backdoors & Breaches", "Facilitate an incident, then validate the response."],
      ["Compliance in Code", "Write compliance checks that run themselves."],
    ],
    "24GB": [
      ["Enterprise Risk", "Quantify risk across an entire environment."],
      ["Fleet Baseline", "Audit Windows and Linux at scale."],
      ["The Full Program", "Assets, risks, controls, vendors, audits, the whole machine."],
      ["Threats to Backlog", "Turn a threat model into a real remediation plan."],
      ["Live Validation", "Tabletop the incident, then prove it against the real lab."],
      ["Continuous Compliance", "Compliance that never stops watching."],
    ],
  },
  forensics: {
    name: "Digital Forensics",
    "8GB": [
      ["Recover the Deleted", "Someone wiped the evidence. Bring it back."],
      ["Ghosts in RAM", "Find the malware that never touched the disk."],
      ["The Timeline", "Prove exactly when, and who, from Windows artifacts."],
      ["Phone Autopsy", "Reconstruct deleted messages from an Android device."],
      ["Decrypt the Traffic", "Crack open \"secure\" traffic and read the secrets."],
      ["Read the Machine", "Reverse a malicious binary to its hidden IP."],
    ],
    "16GB": [
      ["The Full Case", "A real disk image, real questions, real answers."],
      ["Deep Memory", "Larger dumps, hidden processes, real IOCs."],
      ["Super-Timeline", "Every artifact, one timeline, the whole story."],
      ["Live Acquisition", "Pull data from a running device and parse it."],
      ["Network Autopsy", "Extract files, images, and credentials from captured traffic."],
      ["Static + Dynamic RE", "Watch malware run, then read its mind."],
    ],
    "24GB": [
      ["Full-Disk Investigation", "Multi-gigabyte images, court-ready reporting."],
      ["Massive Memory", "Full-size RAM dumps carved to the bone."],
      ["Whole-Disk Timeline", "Correlate an entire disk into a single narrative."],
      ["Mobile + App Forensics", "Tear apart both the app and its data."],
      ["Network Replay", "Reconstruct a full intrusion from the wire."],
      ["The Debugger", "Live-debug malware and defeat its logic."],
    ],
  },
  ai: {
    name: "AI Security",
    "8GB": [
      ["Break the Bot", "Talk an AI into spilling its own secrets."],
      ["Poison the Model", "Feed it lies and watch its accuracy collapse."],
      ["The Hidden Command", "Slip an invisible instruction into an AI's brain."],
      ["The Backdoored Model", "A model file that runs code. Catch it before it runs."],
      ["Web LLM Attacks", "Make an AI chatbot do what it was told never to do."],
      ["Guard the Agent", "Build an AI that can run commands, without getting owned."],
    ],
    "16GB": [
      ["Your Own Oracle", "Run a local AI and attack your own guardrails."],
      ["Adversarial Lab", "Poison, evade, and defend a model you trained yourself."],
      ["The Offline Whisper", "Build a private RAG and break it from the inside."],
      ["Model Autopsy", "Dissect malicious model files down to the payload."],
      ["The Vulnerable App", "Host a full AI app and take it apart."],
      ["The Guardrails", "Production-grade AI defenses vs a real attacker."],
    ],
    "24GB": [
      ["The Big Model", "Attack a 14B local LLM like a real enterprise deployment."],
      ["The Backdoor", "Plant a hidden trigger in a model and watch it obey."],
      ["Enterprise RAG", "Attack and defend a full retrieval system."],
      ["Supply-Chain Gate", "Stop malicious models before they ever reach production."],
      ["Full Stack, Full Attack", "A hosted AI app with tracing. Own it."],
      ["Purple AI", "Guardrails vs a vulnerable agent. Red and blue at once."],
    ],
  },
};

// Fallback for admins / untagged accounts / unknown departments.
const GENERIC = [
  ["Orientation", "setup, scope, reporting basics"],
  ["Recon", "methodology, evidence, notes"],
  ["Execution", "tooling, PoC, validation"],
  ["Hardening", "impact, remediation, proof"],
  ["Capstone", "complete technical report"],
  ["Graduation", "final review and alumni handoff"],
];

const RAM_TIERS = ["8GB", "16GB", "24GB"];

// Resolve the student's roadmap from their joined department (me.domains.key) + RAM tier (me.ram).
// Always returns 6 steps; falls back to the 8GB track, then to a generic track.
export function getTrack(me) {
  const dept = TRACKS[me?.domains?.key];
  const ram = RAM_TIERS.includes(me?.ram) ? me.ram : "8GB";
  const rows = dept?.[ram] || dept?.["8GB"] || GENERIC;
  const steps = rows.map(([label, focus], i) => ({ week: i + 1, label, focus }));
  const name = dept ? `${dept.name} · ${ram} track` : "6-week track";
  return { steps, name };
}
