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
    <main className="min-h-screen bg-[#050505] text-white">

      {/* 
        This relative container holds the 500vh scrolly canvas 
        and the parallax overlay sitting on top of it.
      */}
      <div className="relative w-full">
        <ScrollyCanvas />
        <Overlay />
      </div>

      {/* 
        These sections flow normally in the document,
        appearing after the 500vh scroll completes.
      */}
      <div className="relative z-20 bg-[#050505]">
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
