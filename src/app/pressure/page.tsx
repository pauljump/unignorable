import { fetchStalledProjects, getProjectsByDistrict } from "@/lib/stalled-projects"
import { councilMembers } from "@/data/council-members"
import { getClicksByDistrict, getTotalClicks } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function PressurePage() {
  const allProjects = await fetchStalledProjects()
  const projectsByDistrict = getProjectsByDistrict(allProjects)
  const clicksByDistrict = getClicksByDistrict()
  const totalClicks = getTotalClicks()

  // Build ranked list: merge council members with click counts and project counts
  const ranked = councilMembers
    .map(member => {
      const clicks = clicksByDistrict.find(c => c.district === member.district)?.count || 0
      const projects = projectsByDistrict.get(member.district) || []
      const stalledUnits = projects.reduce((sum, p) => sum + p.units, 0)
      return {
        ...member,
        clicks,
        projectCount: projects.length,
        stalledUnits,
      }
    })
    .sort((a, b) => b.clicks - a.clicks || b.stalledUnits - a.stalledUnits)

  return (
    <main className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b-2 border-black px-4 py-3 flex items-center justify-between">
        <a href="/" className="text-sm font-black uppercase tracking-widest hover:text-[#FF6B00]">
          &larr; UNIGNORABLE
        </a>
        <span className="text-sm font-bold text-black/40 uppercase tracking-widest">
          Pressure Gauge
        </span>
      </header>

      {/* Hero */}
      <section className="border-b-2 border-black px-4 py-8 md:py-12 text-center">
        <div className="text-[6rem] md:text-[10rem] font-black leading-none text-[#FF6B00] tracking-tight">
          {totalClicks.toLocaleString()}
        </div>
        <div className="text-lg md:text-xl font-bold uppercase tracking-widest text-black/60">
          Total constituent emails sent via UNIGNORABLE
        </div>
        <div className="mt-4 text-black/40 font-semibold">
          {allProjects.length} stalled projects &middot; {allProjects.reduce((s, p) => s + p.units, 0).toLocaleString()} units not built
        </div>
      </section>

      {/* Rankings */}
      <section className="px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-black uppercase tracking-tight mb-6">
            All 51 Council Members — Ranked by Constituent Pressure
          </h2>

          <div className="border-2 border-black">
            {/* Header row */}
            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-black text-white text-xs font-bold uppercase tracking-widest">
              <div className="col-span-1">#</div>
              <div className="col-span-4">Council Member</div>
              <div className="col-span-2">District</div>
              <div className="col-span-2 text-right">Emails</div>
              <div className="col-span-1 text-right">Projects</div>
              <div className="col-span-2 text-right">Units Stalled</div>
            </div>

            {ranked.map((member, i) => (
              <a
                key={member.district}
                href={`/district/${member.district}`}
                className={`grid grid-cols-12 gap-2 px-4 py-3 border-t border-black/10 hover:bg-[#FF6B00]/5 transition-colors ${
                  i < 3 && member.clicks > 0 ? "bg-[#FF6B00]/10" : ""
                }`}
              >
                <div className="col-span-1 font-black text-black/30">
                  {i + 1}
                </div>
                <div className="col-span-4 font-bold truncate">
                  {member.name}
                </div>
                <div className="col-span-2 text-sm text-black/60 font-semibold">
                  {member.borough}
                </div>
                <div className="col-span-2 text-right font-black text-[#FF6B00]">
                  {member.clicks > 0 ? member.clicks : "—"}
                </div>
                <div className="col-span-1 text-right font-semibold text-black/60">
                  {member.projectCount}
                </div>
                <div className="col-span-2 text-right font-semibold text-black/60">
                  {member.stalledUnits > 0 ? member.stalledUnits.toLocaleString() : "—"}
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t-2 border-black py-4 px-4 text-center">
        <p className="text-xs uppercase tracking-widest text-black/40 font-semibold">
          Data from NYC Department of Buildings &middot; Updated daily &middot; Share this page
        </p>
      </footer>
    </main>
  )
}
