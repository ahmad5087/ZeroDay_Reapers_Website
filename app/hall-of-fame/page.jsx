import { createClient } from "@supabase/supabase-js";
import HallOfFame from "./HallOfFame";

// Public Best-Intern Hall of Fame. Data is read anonymously via SECURITY DEFINER RPCs:
//  * get_hall_of_fame()  — visible cards (name, domain, photo, LinkedIn, cohort)
//  * domains             — anon-readable, for the per-domain section order
// The passport for each card is lazy-loaded client-side on click. Indexable (unlike /passport, which
// is a per-link secret). Dynamic so a freshly inducted intern shows without a rebuild.
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Hall of Fame — ZeroDay Reapers",
  description: "The standout interns of every ZeroDay Reapers cohort, by domain — each with a verified Skill Passport.",
};

async function getData() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return { domains: [], inductees: [] };
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const [{ data: inductees }, { data: domains }] = await Promise.all([
      sb.rpc("get_hall_of_fame"),
      sb.from("domains").select("id,name,sort,key").not("key", "in", "(lobby,alumni)").order("sort"),
    ]);
    return { domains: domains || [], inductees: Array.isArray(inductees) ? inductees : [] };
  } catch {
    return { domains: [], inductees: [] };
  }
}

export default async function HallOfFamePage() {
  const { domains, inductees } = await getData();
  return <HallOfFame domains={domains} inductees={inductees} />;
}
