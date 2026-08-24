import Link from "next/link";
import WaitlistForm from "../_components/WaitlistForm";

// Public apply / waitlist page (Phase 12 — applicant funnel). Indexable. The form itself is gated by the
// `waitlist` flag (see WaitlistForm); this page is always reachable so the link can be shared/indexed.
export const metadata = {
  title: "Apply — ZeroDay Reapers Internship",
  description: "Join the waitlist for the next ZeroDay Reapers offensive-security internship cohort.",
  alternates: { canonical: "/apply" },
};

export default function ApplyPage() {
  const wrap = { maxWidth: 640, margin: "0 auto", padding: "56px 20px", fontFamily: "system-ui, Segoe UI, Arial, sans-serif", color: "#141414" };
  return (
    <main style={wrap}>
      <p style={{ color: "#e10600", fontSize: 12, textTransform: "uppercase", letterSpacing: 2, fontWeight: 700 }}>Internship</p>
      <h1 style={{ fontSize: 34, margin: "8px 0 10px" }}>Join the next cohort</h1>
      <p style={{ color: "#555", fontSize: 16, lineHeight: 1.6 }}>
        Hands-on offensive security: weekly tasks, real tooling, graded feedback, and a verifiable
        certificate. Leave your email and we'll notify you the moment applications open.
      </p>
      <WaitlistForm />
      <p style={{ color: "#888", fontSize: 13, marginTop: 28 }}>
        Curious what alumni build? See our <Link href="/insights" style={{ color: "#e10600" }}>case studies &amp; outcomes</Link>.
      </p>
    </main>
  );
}
