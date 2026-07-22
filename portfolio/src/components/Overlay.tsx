"use client";

import { useRef } from "react";
import { useScroll, useTransform, motion } from "framer-motion";

export default function Overlay() {
    const containerRef = useRef<HTMLDivElement>(null);

    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start start", "end end"],
    });

    // Section 1 opacity: Fades in early, fades out completely by 25% scroll
    const opacity1 = useTransform(scrollYProgress, [0, 0.1, 0.2, 0.25], [1, 1, 0.5, 0]);
    const y1 = useTransform(scrollYProgress, [0, 0.25], ["0%", "-50%"]); // Parallax up

    // Section 2 opacity: Fades in around 25%, fully visible at 30%, fades out by 55%
    const opacity2 = useTransform(scrollYProgress, [0.2, 0.3, 0.45, 0.55], [0, 1, 1, 0]);
    const y2 = useTransform(scrollYProgress, [0.2, 0.55], ["20%", "-20%"]);

    // Section 3 opacity: Fades in around 55%, fully visible at 60%, stays visible briefly, fades out
    const opacity3 = useTransform(scrollYProgress, [0.5, 0.6, 0.8, 0.9], [0, 1, 1, 0]);
    const y3 = useTransform(scrollYProgress, [0.5, 0.9], ["20%", "-20%"]);

    return (
        <div ref={containerRef} className="absolute top-0 left-0 w-full h-[500vh] pointer-events-none z-10">
            <div className="sticky top-0 h-screen w-full flex items-center justify-center overflow-hidden">

                {/* Section 1 - 0% */}
                <motion.div
                    style={{ opacity: opacity1, y: y1 }}
                    className="absolute inset-0 flex flex-col items-center justify-center text-center px-4"
                >
                    <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-4 text-white text-glow drop-shadow-xl">
                        Ali Raza.
                    </h1>
                    <p className="text-xl md:text-2xl text-gray-300 font-light max-w-xl drop-shadow-md mb-8">
                        Cybersecurity Professional &<br />Ethical Hacking Instructor.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center gap-4 pointer-events-auto">
                        <a
                            href="https://www.linkedin.com/in/aliraza999"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-6 py-3 rounded-full bg-[#e10600] text-[#050505] font-semibold shadow-[0_0_24px_rgba(225,6,0,0.6)] hover:bg-[#ff1a1a] hover:shadow-[0_0_40px_rgba(255,26,26,0.9)] transition-all"
                        >
                            Connect on LinkedIn
                        </a>
                        <a
                            href="mailto:alirazaa.mxm@gmail.com"
                            className="px-6 py-3 rounded-full bg-zinc-900/50 border border-zinc-700 text-white font-medium hover:bg-zinc-800 transition-colors backdrop-blur-md"
                        >
                            Email Me
                        </a>
                    </div>
                </motion.div>

                {/* Section 2 - 30% */}
                <motion.div
                    style={{ opacity: opacity2, y: y2 }}
                    className="absolute inset-0 flex flex-col items-start justify-center text-left px-8 md:px-24 pointer-events-none"
                >
                    <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-4 text-white drop-shadow-xl">
                        Empowering <span className="text-[#e10600]">students</span>.
                    </h2>
                    <p className="text-lg md:text-2xl text-gray-200 max-w-2xl drop-shadow-md font-light leading-relaxed pointer-events-auto">
                        Master ethical hacking, threat detection, and cloud security.<br />
                        Prepare for CEH, PNPT, eJPT, and more.
                    </p>
                </motion.div>

                {/* Section 3 - 60% */}
                <motion.div
                    style={{ opacity: opacity3, y: y3 }}
                    className="absolute inset-0 flex flex-col items-end justify-center text-right px-8 md:px-24"
                >
                    <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-4 text-white drop-shadow-xl">
                        Securing <span className="text-[#ff1a1a]">organizations</span>.
                    </h2>
                    <p className="text-lg md:text-2xl text-gray-200 max-w-2xl drop-shadow-md font-light leading-relaxed">
                        Identify vulnerabilities through Penetration Testing & Red Teaming.<br />
                        Secure systems strategically across AWS, Azure, and GCP.
                    </p>
                </motion.div>

            </div>
        </div>
    );
}
