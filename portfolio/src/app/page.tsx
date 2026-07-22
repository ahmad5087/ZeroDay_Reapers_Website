import ScrollyCanvas from "@/components/ScrollyCanvas";
import Overlay from "@/components/Overlay";
import Projects from "@/components/Projects";
import Experience from "@/components/Experience";
import Certifications from "@/components/Certifications";
import Education from "@/components/Education";
import Volunteering from "@/components/Volunteering";
import Contact from "@/components/Contact";

export default function Home() {
  return (
    <main className="relative min-h-screen bg-[#050505] text-white">

      {/* Ambient red glow + faint grid behind everything — matches the main site */}
      <div className="pointer-events-none fixed inset-0 z-0 zdr-grid opacity-40" />
      <div className="pointer-events-none fixed inset-0 z-0 zdr-ambience" />

      {/*
        This relative container holds the 500vh scrolly canvas
        and the parallax overlay sitting on top of it.
      */}
      <div className="relative z-10 w-full">
        <ScrollyCanvas />
        <Overlay />
      </div>

      {/*
        These sections flow normally in the document,
        appearing after the 500vh scroll completes.
        Transparent so the ambience shows through.
      */}
      <div className="relative z-10">
        <Projects />
        <Experience />
        <Certifications />
        <Education />
        <Volunteering />
        <Contact />
      </div>

    </main>
  );
}
