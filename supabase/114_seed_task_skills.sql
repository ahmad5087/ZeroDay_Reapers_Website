-- 114_seed_task_skills.sql — Seed tasks.skills for all 6 departments × 6 weeks from the official
-- "Internship Certificate Skills" sheet (6 certificate-ready skills per week, taken from each week's
-- task). This is the data behind the LOR's auto-filled "key skills": admin_certificate_data (113)
-- aggregates these across an intern's approved tasks and ranks them by score, and the studio then
-- takes the strongest 6–10. Run after 113. Idempotent (re-running re-sets the same arrays).
--
-- Matched by department key + week, so it is tier-agnostic (8/16/24 GB share one task per week) and a
-- no-op in CI/test DBs that have no cohort tasks. Admins can still re-tag any task via
-- admin_set_task_skills().

with sk(dept, wk, skills) as (
  values
    -- ===== 1 · Offensive Security =====
    ('offensive', 1, array[
      'SQL injection: login bypass and UNION-based data extraction',
      'Cross-site scripting (stored and reflected)',
      'Web reconnaissance and enumeration (nmap, ffuf, gobuster, Burp Suite)',
      'Linux privilege escalation (linPEAS; SUID / sudo / cron abuse)',
      'Network pivoting and tunneling (Chisel, proxychains)',
      'Professional penetration-test report writing']),
    ('offensive', 2, array[
      'Multi-segment network pivoting across isolated subnets',
      'Tunneling with Chisel and Ligolo-ng',
      'Dual-homed host exploitation and reverse-shell footholds',
      'Internal service and database compromise through a tunnel',
      'Network topology mapping and diagramming',
      'Engagement reporting with a full kill chain']),
    ('offensive', 3, array[
      'Active Directory enumeration with BloodHound / SharpHound',
      'Kerberos attacks: AS-REP roasting and Kerberoasting (hashcat)',
      'ACL abuse for privilege escalation',
      'Kerberos delegation abuse (unconstrained, constrained, RBCD)',
      'AD CS certificate attacks (ESC1 / ESC8 with Certipy)',
      'DCSync and Golden Ticket forgery (impacket, mimikatz)']),
    ('offensive', 4, array[
      'MITRE ATT&CK emulation with Atomic Red Team',
      'Sysmon telemetry analysis',
      'Detection engineering (Sigma rules, PowerShell)',
      'Endpoint threat hunting',
      'ATT&CK Navigator coverage mapping',
      'Purple-team reporting']),
    ('offensive', 5, array[
      'Secret detection in git history (Gitleaks, TruffleHog)',
      'SAST, dependency and IaC scanning (Semgrep, Trivy)',
      'Vulnerability aggregation and triage (DefectDojo)',
      'CI/CD security gating (GitLab CI, OWASP ZAP baseline DAST)',
      'Finding deduplication and severity triage',
      'Shift-left secure-pipeline design']),
    ('offensive', 6, array[
      'End-to-end boot-to-root exploitation',
      'Full-port service enumeration (nmap, nikto, ffuf)',
      'Initial access via web / service exploitation',
      'Privilege escalation to root (GTFOBins, cron, kernel exploits)',
      'Flag capture (user.txt / root.txt) with evidence',
      'Engagement report plus narrated video walkthrough']),
    -- ===== 2 · Defensive Security =====
    ('defensive', 1, array[
      'Threat hunting with Chainsaw and Sigma',
      'Windows event-log analysis and timelining (EvtxECmd)',
      'SIEM operations with Splunk (SPL queries)',
      'Multi-source incident correlation (endpoint, AWS, email)',
      'MITRE ATT&CK technique mapping',
      'Incident report writing (root cause, scope, remediation)']),
    ('defensive', 2, array[
      'Building an isolated malware-analysis lab (REMnux / FLARE-VM)',
      'Static analysis (strings/floss, PE inspection, capa, olevba)',
      'Dynamic analysis / safe detonation with INetSim',
      'YARA signature scanning',
      'IOC extraction (hashes, C2, persistence)',
      'ATT&CK mapping and analyst reporting']),
    ('defensive', 3, array[
      'Network traffic analysis with Zeek',
      'Log pivoting with zeek-cut and jq',
      'Attack reconstruction from NSM logs',
      'IOC extraction (JA3, certificates, file hashes)',
      'Custom Zeek detection scripting (NOTICE / signatures)',
      'ATT&CK mapping and incident narrative']),
    ('defensive', 4, array[
      'Endpoint DFIR with Velociraptor',
      'Fleet-wide threat hunting (Hunt Manager)',
      'Custom VQL query authoring',
      'Persistence-mechanism detection',
      'Cross-endpoint correlation and ATT&CK mapping',
      'Triage collection (KAPE)']),
    ('defensive', 5, array[
      'Honeypot deployment (Cowrie, Dionaea, T-Pot)',
      'Attacker-session reconstruction from honeypot logs',
      'Multi-protocol attack correlation',
      'Captured-malware triage and hashing',
      'Threat-intel / IOC extraction with Kibana dashboards',
      'ATT&CK mapping of the campaign']),
    ('defensive', 6, array[
      'Super-timeline forensics with Plaso / log2timeline',
      'Artifact parsing (MFTECmd, EvtxECmd, RECmd)',
      'Pinpointing the moment of compromise',
      'Tracing the attacker action chain',
      'IOC and ATT&CK extraction',
      'Chronological intrusion narrative plus narrated video']),
    -- ===== 3 · AI Security =====
    ('ai', 1, array[
      'Prompt injection (direct and indirect)',
      'System-prompt extraction',
      'Building a local LLM / RAG app (Ollama, LangChain, Chroma)',
      'RAG document poisoning and tool abuse',
      'Guardrail implementation (LLM Guard, NeMo Guardrails)',
      'Defense block-rate measurement']),
    ('ai', 2, array[
      'Training a CNN classifier (MNIST / Fashion-MNIST)',
      'Evasion attacks (FGSM, PGD with ART / torchattacks)',
      'Data-poisoning attacks (label-flip, trigger patch)',
      'Adversarial-training defense',
      'Robustness measurement (accuracy vs. epsilon)',
      'Results visualization and reporting']),
    ('ai', 3, array[
      'Building a private offline RAG assistant (Ollama + embeddings + Chroma)',
      'Indirect prompt injection via document poisoning',
      'Retrieval-path exploitation (answer manipulation, data exfiltration)',
      'Attack-success-rate measurement',
      'Layered RAG defenses (context spotlighting, provenance, output filtering)',
      'Before/after block-rate evaluation']),
    ('ai', 4, array[
      'Analyzing malicious model files (pickle, PyTorch, Keras)',
      'Model scanning (modelscan, picklescan)',
      'Pickle decompilation and opcode analysis (fickling, pickletools)',
      'Multi-format threat comparison matrix',
      'Serialization-risk mitigation',
      'Security-research reporting']),
    ('ai', 5, array[
      'Web LLM exploitation (PortSwigger Web LLM labs)',
      'LLM API and tool abuse',
      'System-prompt leakage',
      'Indirect prompt injection in retrieved data',
      'Full-stack agent attack tracing (Qdrant, Langfuse)',
      'Mitigation implementation and verification']),
    ('ai', 6, array[
      'Deploying production-grade AI guardrails (NeMo, Llama Guard, Rebuff)',
      'OWASP LLM Top 10 red-teaming',
      'Automated LLM vulnerability scanning (garak)',
      'Before/after bypass-rate measurement',
      'Guardrail tuning without breaking legitimate use',
      'Security report plus narrated video']),
    -- ===== 4 · Governance, Risk & Compliance =====
    ('grc', 1, array[
      'Asset inventory and vulnerability identification',
      'NIST SP 800-30 risk assessment with NIST CSF mapping',
      'Quantitative risk analysis (FAIR)',
      'Control-framework gap analysis (CIS v8 / ISO 27001 Annex A)',
      'Compliance auditing (CIS-CAT Lite, Lynis)',
      'Policy and remediation-roadmap authoring']),
    ('grc', 2, array[
      'Automated CIS benchmark scanning (CIS-CAT Lite, OpenSCAP, Lynis)',
      'Interpreting compliance scores and failed controls',
      'Risk-based remediation triage',
      'System hardening',
      'Before/after re-scan validation',
      'Audit reporting with residual-risk analysis']),
    ('grc', 3, array[
      'Deploying and operating a GRC platform (Eramba)',
      'Asset and risk register management',
      'Control-to-framework mapping (ISO 27001 / CIS)',
      'Policy and risk-treatment-plan management',
      'Review-cycle workflow execution',
      'CISO-level risk / compliance reporting']),
    ('grc', 4, array[
      'Threat modeling with STRIDE',
      'Data Flow Diagram and trust-boundary design (OWASP Threat Dragon)',
      'Threat identification against a live application',
      'Threat validation through hands-on testing',
      'Predicted-vs-confirmed threat matrix',
      'Mitigation recommendations']),
    ('grc', 5, array[
      'Incident-response tabletop facilitation (Backdoors & Breaches)',
      'NIST SP 800-61 IR-lifecycle mapping',
      'After-action report (AAR) writing',
      'ATT&CK-based detection validation',
      'Assumed-vs-verified coverage analysis',
      'Detection-engineering gap backlog']),
    ('grc', 6, array[
      'Compliance-as-code authoring (Chef InSpec / OPA Rego)',
      'Encoding CIS controls as executable tests',
      'Automated control evaluation and reporting',
      'Remediation and passing re-run',
      'Control-to-standard mapping',
      'Repeatable, CI-ready test suites plus narrated video']),
    -- ===== 5 · Cloud Security =====
    ('cloud', 1, array[
      'Building a local cloud attack range (LocalStack + Terraform)',
      'S3 bucket misconfiguration exploitation',
      'IAM enumeration and privilege escalation',
      'SSRF-to-instance-metadata credential theft',
      'Detection via CloudTrail logs',
      'Remediation (least privilege, IMDSv2, bucket policy)']),
    ('cloud', 2, array[
      'Building a local Kubernetes cluster (minikube)',
      'K8s attack scenarios (secrets in env, SSRF, container escape, RBAC abuse)',
      'Exploiting Kubernetes Goat',
      'Pod and RBAC hardening (PodSecurity, NetworkPolicy, seccomp)',
      'Remediation and re-testing',
      'Cluster security reporting']),
    ('cloud', 3, array[
      'Infrastructure-as-Code scanning (Checkov, Trivy)',
      'Pre-commit security hooks',
      'CI security gating (GitHub Actions run locally with act)',
      'Fail-threshold policy design',
      'Blocked-vs-passing pipeline validation',
      'Shift-left security practice']),
    ('cloud', 4, array[
      'Deploying serverless / Lambda functions (LocalStack)',
      'SSRF exploitation (file:///proc/self/environ)',
      'Runtime credential theft from a function',
      'Post-exploitation with stolen IAM credentials',
      'IAM role / permission enumeration',
      'Serverless hardening (input validation, least privilege, monitoring)']),
    ('cloud', 5, array[
      'CloudTrail log analysis (jq)',
      'Detecting no-MFA console logins',
      'Reconstructing a cloud attack timeline',
      'Building a cloud SIEM (Elasticsearch / Kibana + Filebeat)',
      'Sigma rule conversion and alerting (ElastAlert)',
      'ATT&CK coverage heatmaps and rule tuning']),
    ('cloud', 6, array[
      'Deploying local cloud / K8s infrastructure (LocalStack / minikube)',
      'Attack-surface mapping and exploitation (secrets, SSRF, escape, RBAC/IAM)',
      'CIS benchmarking (kube-bench, Checkov, Trivy)',
      'Least-privilege hardening',
      'Re-test validation of each fix',
      'Before/after benchmarking plus narrated video']),
    -- ===== 6 · Digital Forensics =====
    ('forensics', 1, array[
      'Disk forensics and deleted-file recovery (Autopsy, KAPE)',
      'Memory forensics (Volatility 3)',
      'Windows artifact analysis (Registry, Prefetch, LNK — Eric Zimmerman tools)',
      'Network forensics (Wireshark, NetworkMiner)',
      'Super-timeline correlation across evidence types',
      'Court-ready forensic reporting']),
    ('forensics', 2, array[
      'Advanced memory forensics (Volatility 3)',
      'Detecting process injection and hollowing (malfind, ldrmodules)',
      'Carving payloads from memory and hashing them',
      'YARA scanning of memory',
      'IOC consolidation (netscan, cmdline, registry)',
      'Process-tree narrative reconstruction']),
    ('forensics', 3, array[
      'Super-timeline generation with Plaso (log2timeline / psort)',
      'Fusing multi-artifact sources (filesystem, registry, event logs, browser, prefetch)',
      'Timeline filtering and keyword tagging',
      'Incident-window correlation',
      'Evidence-backed intrusion narrative',
      'Forensic reporting']),
    ('forensics', 4, array[
      'Live / volatile data acquisition (ADB)',
      'Android filesystem extraction',
      'Chain-of-custody hashing (SHA-256)',
      'Automated artifact parsing (ALEAPP)',
      'SQLite artifact analysis (SMS, calls, browser, Wi-Fi)',
      'Forensic acquisition reporting']),
    ('forensics', 5, array[
      'Decrypting captured traffic (TLS keylog / WPA2)',
      'Traffic indexing and carving (Zeek, NetworkMiner)',
      'Credential, file and object extraction with hashing',
      'IDS replay and alert correlation (Suricata, tcpreplay)',
      'Session reconstruction',
      'ATT&CK-mapped intrusion timeline']),
    ('forensics', 6, array[
      'Building an isolated RE lab (FLARE-VM + REMnux)',
      'Static analysis and disassembly (Ghidra, floss, capa, PE-bear)',
      'Dynamic detonation and behavior capture (Procmon, INetSim, Wireshark)',
      'Correlating static code with dynamic behavior',
      'C2 / config and IOC extraction',
      'ATT&CK-mapped report plus narrated video'])
)
update public.tasks t
   set skills = sk.skills
  from sk
  join public.domains d on d.key = sk.dept
 where t.domain_id = d.id and t.week = sk.wk;
