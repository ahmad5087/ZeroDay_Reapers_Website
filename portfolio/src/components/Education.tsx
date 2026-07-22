import { GraduationCap } from "lucide-react";

export default function Education() {
    const education = [
        {
            degree: "Bachelor's in Computer Science",
            school: "Government College University Faisalabad",
            period: "2020 - 2024",
            description: "Core academic focus on programming logic, network systems, and software engineering.",
        },
        {
            degree: "Intermediate in Computer Science",
            school: "Pakistan International School Jeddah",
            period: "2017 - 2019",
            description: "Foundational studies in mathematics, physics, and computer science concepts.",
        },
    ];

    return (
        <section className="relative z-20 bg-[#050505] py-20 px-4 md:px-12 lg:px-24 mb-32">
            <div className="max-w-4xl mx-auto">

                <div className="mb-16 flex items-center gap-4">
                    <GraduationCap className="w-8 h-8 text-[#e10600]" />
                    <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
                        Education
                    </h2>
                </div>

                <div className="space-y-12">
                    {education.map((edu, i) => (
                        <div key={i} className="flex flex-col md:flex-row md:items-start justify-between gap-4 md:gap-12 pb-12 last:pb-0">
                            <div className="md:w-1/3 flex flex-col pt-1">
                                <span className="text-zinc-500 font-mono text-sm uppercase tracking-widest mb-2">
                                    {edu.period}
                                </span>
                                <span className="text-xl font-semibold text-zinc-100 mb-1">
                                    {edu.school}
                                </span>
                            </div>
                            <div className="md:w-2/3">
                                <h3 className="text-xl md:text-2xl font-medium text-white mb-4">
                                    {edu.degree}
                                </h3>
                                <p className="text-zinc-400 leading-relaxed max-w-lg">
                                    {edu.description}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>

            </div>
        </section>
    );
}
