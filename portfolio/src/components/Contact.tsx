import { Mail, Linkedin } from "lucide-react";

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
                        <Linkedin className="w-5 h-5" />
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
