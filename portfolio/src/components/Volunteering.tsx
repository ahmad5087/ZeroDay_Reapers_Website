import { HeartHandshake } from "lucide-react";

export default function Volunteering() {
    const volunteering = [
        {
            role: "Volunteer, Social Services",
            org: "Ministry of Health, Saudi Arabia",
            period: "Jul 2018 - Sep 2018",
            description: "Awarded for active contribution to the Health Education process for Pakistani pilgrims during Hajj Season 1439H. Collaborated with Saudi Health Education Ambassadors to disseminate vital public-health information and ensure pilgrim safety. Recognized by the Department of Public Health (Jeddah) for effective cross-cultural communication and cooperation.",
        },
        {
            role: "Volunteer, Social Services",
            org: "Office of Pilgrims Affairs, Pakistan",
            period: "Jul 2018 - Sep 2018",
            description: "Served as a Local Moavin at the Hajj Terminal Jeddah during the 2018 Hajj season, facilitating pilgrim logistics and arrival/departure processes for smooth transit. Recognized by the Overall Incharge as honest, faithful, and hardworking, and commended for maintaining good moral character in a high-pressure international environment.",
        },
    ];

    return (
        <section className="relative z-20 bg-transparent py-20 px-4 md:px-12 lg:px-24">
            <div className="max-w-4xl mx-auto">

                <div className="mb-16 flex items-center gap-4">
                    <HeartHandshake className="w-8 h-8 text-[#e10600]" />
                    <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
                        Volunteering
                    </h2>
                </div>

                <div className="space-y-12">
                    {volunteering.map((v, i) => (
                        <div key={i} className="group flex flex-col md:flex-row md:items-start justify-between gap-4 md:gap-12 pb-12 border-b border-zinc-800/50 last:border-0">
                            <div className="md:w-1/3 flex flex-col pt-1">
                                <span className="text-zinc-500 font-mono text-sm uppercase tracking-widest mb-2">
                                    {v.period}
                                </span>
                                <span className="text-xl font-semibold text-zinc-100 mb-1">
                                    {v.org}
                                </span>
                            </div>
                            <div className="md:w-2/3">
                                <h3 className="text-2xl font-medium text-white mb-4 group-hover:text-zinc-300 transition-colors">
                                    {v.role}
                                </h3>
                                <p className="text-zinc-400 leading-relaxed">
                                    {v.description}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>

            </div>
        </section>
    );
}
