import { Briefcase } from "lucide-react";

export default function Experience() {
    const experiences = [
        {
            role: "Offensive Security (Fellowship)",
            company: "Black Byt3",
            location: "Florida, USA · Remote",
            period: "Feb 2026 - Jun 2026",
            description: "Conducted web application penetration testing against the OWASP Top 10 with Burp Suite and automated tooling. Deployed and compromised Active Directory labs using Kerberoasting, Pass-the-Hash, and BloodHound mapping. Built a custom asset-discovery tool with Shodan API integration for subdomain enumeration, live-IP filtering, and CVE identification; engineered VBS scripts for automated credential extraction, and authored professional pentest reports using CVSS v3 scoring.",
        },
        {
            role: "Founder & CEO",
            company: "ZeroDay Reapers",
            location: "Pakistan · Self-Employed",
            period: "Sep 2025 - Present",
            description: "Founded an offensive-security collective delivering penetration testing, red teaming, and cloud security across AWS, Azure, and GCP. Run a 6-week remote internship across 6 departments — Offensive Security, Defensive Security, Cloud Security, Governance & Compliance, Digital Forensics, and AI Security — built on real-world tasks with verifiable completion certificates. Trained 100+ students to date. Adversary-first, report-driven.",
        },
        {
            role: "Ethical Hacking Instructor",
            company: "TECH-HUB Systems (PVT) Limited",
            location: "Faisalabad, Pakistan",
            period: "Mar 2025 - Jun 2025",
            description: "Delivered training on penetration testing, network security, and vulnerability assessment. Designed CEH-, OSCP-, and CompTIA Security+-aligned curriculum and ran hands-on labs with Metasploit, Nmap, Wireshark, and Burp Suite. Mentored and assessed students through practical exams and CTF challenges while enforcing legal boundaries and responsible-disclosure standards.",
        },
        {
            role: "Cyber Security Specialist",
            company: "Creatix Sol",
            location: "Lahore, Pakistan · Remote",
            period: "Dec 2024 - Present",
            description: "Cybersecurity engagements supporting client infrastructure security.",
        },
    ];

    return (
        <section className="relative z-20 bg-[#050505] py-20 px-4 md:px-12 lg:px-24">
            <div className="max-w-4xl mx-auto">

                <div className="mb-16 flex items-center gap-4">
                    <Briefcase className="w-8 h-8 text-[#e10600]" />
                    <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
                        Work Experience
                    </h2>
                </div>

                <div className="space-y-12">
                    {experiences.map((exp, i) => (
                        <div key={i} className="group flex flex-col md:flex-row md:items-start justify-between gap-4 md:gap-12 pb-12 border-b border-zinc-800/50 last:border-0">
                            <div className="md:w-1/3 flex flex-col pt-1">
                                <span className="text-zinc-500 font-mono text-sm uppercase tracking-widest mb-2">
                                    {exp.period}
                                </span>
                                <span className="text-xl font-semibold text-zinc-100 mb-1">
                                    {exp.company}
                                </span>
                                <span className="text-sm text-zinc-500">
                                    {exp.location}
                                </span>
                            </div>
                            <div className="md:w-2/3">
                                <h3 className="text-2xl font-medium text-white mb-4 group-hover:text-zinc-300 transition-colors">
                                    {exp.role}
                                </h3>
                                <p className="text-zinc-400 leading-relaxed">
                                    {exp.description}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>

            </div>
        </section>
    );
}
