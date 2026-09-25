import { Mail } from "lucide-react";

// lucide-react v1 removed brand icons (incl. Linkedin); provide a local inline-SVG mark.
function LinkedinIcon({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
        </svg>
    );
}

export default function Contact() {
    return (
        <section className="relative z-20 bg-transparent py-24 px-4 md:px-12 lg:px-24 border-t border-zinc-800/50">
            <div className="max-w-4xl mx-auto text-center">
                <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-6">
                    Let's Connect
                </h2>
                <p className="text-zinc-400 max-w-xl mx-auto mb-10 text-lg">
                    Whether you're looking to secure your organization's infrastructure or want to learn the art of ethical hacking, my inbox is always open.
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
                    <a
                        href="https://www.linkedin.com/in/aliraza999"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-8 py-4 bg-[#e10600] text-[#050505] rounded-full font-semibold shadow-[0_0_24px_rgba(225,6,0,0.6)] hover:bg-[#ff1a1a] hover:shadow-[0_0_40px_rgba(255,26,26,0.9)] transition-all duration-300"
                    >
                        <LinkedinIcon className="w-5 h-5" />
                        Connect on LinkedIn
                    </a>

                    <a
                        href="mailto:alirazaa.mxm@gmail.com"
                        className="flex items-center gap-3 px-8 py-4 bg-zinc-900/50 border border-zinc-700 text-white rounded-full font-semibold hover:bg-zinc-800 transition-colors duration-300 backdrop-blur-md"
                    >
                        <Mail className="w-5 h-5" />
                        Email Me
                    </a>
                </div>
            </div>
        </section>
    );
}
