import { ArrowUpRight, FolderGit2 } from "lucide-react";

export default function Projects() {
    const projects = [
        {
            title: "Python Network Sniffer",
            category: "Network Security",
            description: "A lightweight, cross-platform network packet sniffer built with Python and Scapy. Captures real-time traffic, analyzes IP headers, and identifies TCP, UDP, and ICMP protocols with specific detection for HTTP traffic.",
            tags: ["Python", "Scapy", "TCP/UDP/ICMP", "HTTP Analysis"],
            link: "#",
        },
        {
            title: "OpenWrt Split-Zone Network Bridge",
            category: "Network Infrastructure",
            description: "Transforms a Raspberry Pi 4 into a professional-grade network bridge. Creates a dual-zone network — keeping heavy family traffic separate from a lag-free, ad-blocked private gaming zone.",
            tags: ["OpenWrt", "Raspberry Pi 4", "VLAN", "Pi-Hole"],
            link: "#",
        },
        {
            title: "Raspberry Pi Nextcloud with Tailscale",
            category: "Self-Hosted Cloud",
            description: "A secure, self-hosted personal cloud on a Raspberry Pi 4B with Nextcloud, Apache, and Tailscale. Private file storage with remote access from anywhere and end-to-end encryption on low-cost, energy-efficient hardware.",
            tags: ["Raspberry Pi 4B", "Nextcloud", "Apache", "Tailscale"],
            link: "https://tinyurl.com/ms8zmdj6",
        },
        {
            title: "Pi-Secure-Auth-Controller",
            category: "Hardware Security",
            description: "An all-in-one hardware security module for Raspberry Pi that acts as a physical authentication key, boot manager, and PC power controller.",
            tags: ["Raspberry Pi", "RFID", "Hardware", "Python"],
            link: "https://tinyurl.com/vmtptwa3",
        },
        {
            title: "Network-Wide Ad-Blocker with RFID Auth & IDS",
            category: "Network Security",
            description: "A Raspberry Pi network security appliance combining Pi-Hole ad-blocking, Suricata IDS for real-time intrusion detection, and RFID-based physical authentication. Features a centralized Flask dashboard and Loggly cloud monitoring.",
            tags: ["Pi-Hole", "Suricata", "Flask", "Loggly", "RFID"],
            link: "#",
        },
    ];

    return (
        <section className="relative z-20 bg-transparent py-32 px-4 md:px-12 lg:px-24">
            <div className="max-w-7xl mx-auto">

                <div className="mb-20 flex items-center gap-4">
                    <FolderGit2 className="w-8 h-8 text-[#e10600]" />
                    <h2 className="text-4xl md:text-6xl font-bold tracking-tight text-white">
                        Selected Works
                    </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
                    {projects.map((project, i) => (
                        <a
                            key={i}
                            href={project.link}
                            className="group relative block w-full rounded-2xl overflow-hidden bg-zinc-900/50 border border-zinc-800/50 hover:border-zinc-700 transition-colors duration-500 backdrop-blur-sm p-8 flex flex-col justify-between min-h-[300px]"
                        >
                            {/* Hover Glow */}
                            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

                            <div className="relative z-10 flex flex-col h-full justify-between">
                                <div className="flex justify-between items-start mb-8">
                                    <span className="text-xs font-mono text-zinc-400 uppercase tracking-widest">
                                        {project.category}
                                    </span>
                                    <div className="p-2 bg-white/5 rounded-full backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all duration-500 -translate-y-2 group-hover:translate-y-0">
                                        <ArrowUpRight className="w-5 h-5 text-white" />
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-2xl font-semibold text-white mb-3 tracking-tight">
                                        {project.title}
                                    </h3>
                                    <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                                        {project.description}
                                    </p>

                                    <div className="flex flex-wrap gap-2">
                                        {project.tags.map((tag, j) => (
                                            <span
                                                key={j}
                                                className="px-3 py-1 text-xs font-medium text-zinc-300 bg-white/5 rounded-full border border-white/5 backdrop-blur-md"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </a>
                    ))}
                </div>

            </div>
        </section>
    );
}
