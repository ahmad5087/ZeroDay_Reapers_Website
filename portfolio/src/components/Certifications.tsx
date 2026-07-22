import { Award, ArrowUpRight } from "lucide-react";

export default function Certifications() {
    const certifications = [
        {
            name: "Core Networking Concepts for Ethical Hackers",
            date: "Dec 2025",
            issuer: "TheXSSRat",
            link: "https://thexssrat.podia.com/certificates/cert_D2gcZrkN",
        },
        {
            name: "Multi-Cloud Red Teaming Analyst",
            date: "Nov 2025",
            issuer: "CyberWarFare Labs",
            link: "https://labs.cyberwarfare.live/credential/achievement/6924ce0452442768760246c6",
        },
        {
            name: "Practical Ethical Hacking",
            date: "Jul 2024",
            issuer: "TCM Security",
            link: "",
        },
        {
            name: "Certified in Cybersecurity — Specialization",
            date: "Feb 2024",
            issuer: "Coursera",
            link: "https://www.coursera.org/account/accomplishments/specialization/6E549KQS2B9G",
        },
        {
            name: "IBM and ISC2 Cybersecurity Specialist — Professional Certificate",
            date: "Jan 2024",
            issuer: "Coursera",
            link: "https://www.coursera.org/account/accomplishments/professional-cert/FHNV5F8MXJRC",
        },
        {
            name: "Ultimate AWS Certified Solutions Architect Associate (SAA-C03)",
            date: "May 2023",
            issuer: "Udemy",
            link: "https://www.udemy.com/certificate/UC-6acb7a4c-aade-4f8f-82e9-18218d4130a4/",
        },
        {
            name: "Fundamentals of Red Hat Enterprise Linux",
            date: "Oct 2022",
            issuer: "Coursera",
            link: "https://www.coursera.org/account/accomplishments/verify/M9RGQXL3X3WX",
        },
    ];

    return (
        <section className="relative z-20 bg-transparent py-20 px-4 md:px-12 lg:px-24">
            <div className="max-w-4xl mx-auto">

                <div className="mb-16 flex items-center gap-4">
                    <Award className="w-8 h-8 text-[#e10600]" />
                    <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
                        Licenses &amp; Certifications
                    </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {certifications.map((cert, i) => {
                        const Tag = cert.link ? "a" : "div";
                        return (
                            <Tag
                                key={i}
                                {...(cert.link ? { href: cert.link, target: "_blank", rel: "noopener noreferrer" } : {})}
                                className="group relative p-8 rounded-2xl bg-zinc-900/40 border border-zinc-800 hover:border-[#e10600]/50 transition-colors backdrop-blur flex items-start gap-4"
                            >
                                <div className="p-3 bg-zinc-800 rounded-xl group-hover:bg-[#e10600]/20 transition-colors shrink-0">
                                    <Award className="w-6 h-6 text-zinc-300 group-hover:text-[#e10600] transition-colors" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-white mb-2 tracking-tight group-hover:text-zinc-200 transition-colors leading-snug">
                                        {cert.name}
                                    </h3>
                                    <div className="flex items-center gap-3 text-sm font-mono tracking-wider uppercase text-zinc-500">
                                        <span>{cert.issuer}</span>
                                        <span className="w-1 h-1 rounded-full bg-zinc-600 shrink-0" />
                                        <span>{cert.date}</span>
                                    </div>
                                </div>
                                {cert.link && (
                                    <ArrowUpRight className="w-5 h-5 text-zinc-600 absolute top-6 right-6 opacity-0 group-hover:opacity-100 group-hover:text-[#e10600] transition-all" />
                                )}
                            </Tag>
                        );
                    })}
                </div>

            </div>
        </section>
    );
}
