"use client"

import { useState } from "react"
import { StalledProject } from "@/lib/stalled-projects"
import { getEmailTemplate, buildMailtoLink } from "@/lib/email-templates"
import { analyzeStall, StallAnalysis } from "@/lib/stall-reasons"
import type { CouncilMember } from "@/data/council-members"

interface Props {
  member: CouncilMember
  projects: StalledProject[]
}

function SeverityDot({ severity }: { severity: "critical" | "high" | "medium" }) {
  const colors = {
    critical: "bg-red-600",
    high: "bg-[#FF6B00]",
    medium: "bg-yellow-500",
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[severity]} mr-2 shrink-0 mt-1.5`} />
}

function WhyPanel({ analysis }: { analysis: StallAnalysis }) {
  return (
    <div className="mt-4 border-t-2 border-black/10 pt-4 animate-in">
      {/* Summary */}
      <p className="text-sm font-semibold text-black/70 mb-4 leading-relaxed">
        {analysis.summary}
      </p>

      {/* Timeline */}
      <div className="mb-5">
        <div className="text-xs font-black uppercase tracking-widest text-black/30 mb-3">Timeline</div>
        <div className="relative pl-6">
          <div className="absolute left-[7px] top-1 bottom-1 w-[2px] bg-black/10" />
          {analysis.timeline.map((event, i) => (
            <div key={i} className="relative mb-3 last:mb-0">
              <div className={`absolute left-[-19px] top-1 w-4 h-4 rounded-full border-2 ${
                event.status === "complete"
                  ? "bg-black border-black"
                  : event.status === "stalled"
                    ? "bg-[#FF6B00] border-[#FF6B00]"
                    : "bg-white border-red-600 border-dashed"
              }`} />
              <div className="text-xs font-bold text-black/40 uppercase tracking-wider">
                {event.date}
              </div>
              <div className={`text-sm font-semibold ${
                event.status === "missing" ? "text-red-600" : "text-black/80"
              }`}>
                {event.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reasons */}
      <div>
        <div className="text-xs font-black uppercase tracking-widest text-black/30 mb-3">Why it&apos;s stalled</div>
        <div className="space-y-3">
          {analysis.reasons.map((reason, i) => (
            <div key={i} className="flex items-start gap-1">
              <SeverityDot severity={reason.severity} />
              <div>
                <div className="text-sm font-bold text-black">{reason.headline}</div>
                <div className="text-xs text-black/50 leading-relaxed mt-0.5">{reason.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  member,
  onEmailClick,
}: {
  project: StalledProject
  member: CouncilMember
  onEmailClick: (project: StalledProject) => void
}) {
  const [showWhy, setShowWhy] = useState(false)
  const analysis = showWhy ? analyzeStall(project) : null

  const severityColor =
    project.yearsStalled >= 5 ? "border-l-red-600" :
    project.yearsStalled >= 3 ? "border-l-[#FF6B00]" :
    "border-l-yellow-500"

  return (
    <div className={`border-2 border-black border-l-8 ${severityColor} p-4 md:p-6 hover:border-[#FF6B00] transition-colors`}>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-xl md:text-2xl font-black uppercase">
            {project.address}
          </h3>
          <div className="text-sm text-black/60 font-semibold mt-1">
            {project.borough} &middot; {project.units} units &middot; {project.stories} stories &middot; {project.owner}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="inline-block px-2 py-1 bg-black text-white text-xs font-bold uppercase">
              {project.statusDescription}
            </span>
            <span className={`inline-block px-2 py-1 text-white text-xs font-bold uppercase ${
              project.yearsStalled >= 5 ? "bg-red-600" : "bg-[#FF6B00]"
            }`}>
              {project.yearsStalled} years stalled
            </span>
            <button
              onClick={() => setShowWhy(!showWhy)}
              className={`inline-block px-3 py-1 text-xs font-black uppercase tracking-wider border-2 transition-colors ${
                showWhy
                  ? "bg-black text-white border-black"
                  : "bg-white text-black border-black hover:bg-black hover:text-white"
              }`}
            >
              {showWhy ? "Close" : "Why?"}
            </button>
          </div>
          {!showWhy && project.description && (
            <p className="mt-3 text-sm text-black/50 font-semibold line-clamp-2">
              {project.description}
            </p>
          )}

          {/* WHY panel */}
          {showWhy && analysis && <WhyPanel analysis={analysis} />}
        </div>
        <button
          onClick={() => onEmailClick(project)}
          className="shrink-0 px-6 py-3 bg-[#FF6B00] text-white font-black uppercase tracking-wider text-lg hover:bg-black transition-colors"
        >
          Email {member.name.split(" ").pop()}
        </button>
      </div>
    </div>
  )
}

export function DistrictClient({ member, projects }: Props) {
  const [subscribeEmail, setSubscribeEmail] = useState("")
  const [subscribed, setSubscribed] = useState(false)
  const [selectedProject, setSelectedProject] = useState<StalledProject | null>(null)

  async function handleEmailClick(project: StalledProject) {
    fetch("/api/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ district: member.district, jobId: project.jobId }),
    })

    const template = getEmailTemplate(project, member.name.split(" ").pop() || member.name)
    const mailto = buildMailtoLink(member.email, template)
    window.location.href = mailto

    setSelectedProject(project)
    setTimeout(() => {
      const el = document.getElementById("subscribe")
      el?.scrollIntoView({ behavior: "smooth" })
    }, 500)
  }

  async function handleSubscribe(e: React.FormEvent) {
    e.preventDefault()
    await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: subscribeEmail,
        district: member.district,
        jobId: selectedProject?.jobId,
      }),
    })
    setSubscribed(true)
  }

  const totalUnits = projects.reduce((sum, p) => sum + p.units, 0)
  const avgYearsStalled = projects.length > 0
    ? Math.round(projects.reduce((sum, p) => sum + p.yearsStalled, 0) / projects.length)
    : 0
  const estimatedPeople = Math.floor(totalUnits * 2.5)

  return (
    <main className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b-2 border-black px-4 py-3">
        <a href="/" className="text-sm font-black uppercase tracking-widest hover:text-[#FF6B00]">
          &larr; UNIGNORABLE
        </a>
      </header>

      {/* CM Info */}
      <section className="border-b-2 border-black px-4 py-8 md:py-12">
        <div className="max-w-4xl mx-auto">
          <div className="text-sm uppercase tracking-widest text-black/40 font-bold mb-2">
            District {member.district} &middot; {member.borough}
          </div>
          <h1 className="text-5xl md:text-7xl font-black uppercase leading-[0.9] tracking-tight">
            {member.name}
          </h1>
          <div className="mt-4 text-lg text-black/60 font-semibold">
            {member.neighborhoods}
          </div>

          {/* District Stats */}
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <div className="text-4xl md:text-5xl font-black text-[#FF6B00]">
                {projects.length}
              </div>
              <div className="text-xs uppercase tracking-widest text-black/40 font-bold">
                Stalled Projects
              </div>
            </div>
            <div>
              <div className="text-4xl md:text-5xl font-black text-[#FF6B00]">
                {totalUnits.toLocaleString()}
              </div>
              <div className="text-xs uppercase tracking-widest text-black/40 font-bold">
                Units Not Built
              </div>
            </div>
            <div>
              <div className="text-4xl md:text-5xl font-black text-[#FF6B00]">
                ~{estimatedPeople.toLocaleString()}
              </div>
              <div className="text-xs uppercase tracking-widest text-black/40 font-bold">
                People Not Housed
              </div>
            </div>
            <div>
              <div className="text-4xl md:text-5xl font-black text-[#FF6B00]">
                {avgYearsStalled}
              </div>
              <div className="text-xs uppercase tracking-widest text-black/40 font-bold">
                Avg Years Stalled
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Projects */}
      <section className="px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="text-2xl font-black uppercase tracking-tight">
              Stalled Projects
            </h2>
            <div className="text-xs font-bold uppercase tracking-widest text-black/30">
              Click &quot;Why?&quot; on any project
            </div>
          </div>

          {projects.length === 0 ? (
            <p className="text-lg text-black/60 font-semibold">
              No stalled projects with 10+ units found in this district.
            </p>
          ) : (
            <div className="space-y-4">
              {projects.map(project => (
                <ProjectCard
                  key={project.jobId}
                  project={project}
                  member={member}
                  onEmailClick={handleEmailClick}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Subscribe (shows after email click) */}
      {selectedProject && (
        <section id="subscribe" className="border-t-2 border-black px-4 py-8 bg-black text-white">
          <div className="max-w-xl mx-auto text-center">
            {subscribed ? (
              <>
                <div className="text-4xl font-black text-[#FF6B00] mb-2">You&apos;re in.</div>
                <p className="text-lg font-semibold text-white/60">
                  We&apos;ll alert you when projects stall near you.
                </p>
              </>
            ) : (
              <>
                <h3 className="text-2xl font-black uppercase mb-2">
                  Get alerts when projects stall near you
                </h3>
                <p className="text-white/60 font-semibold mb-6">
                  We&apos;ll email you when new stalled projects appear in District {member.district}.
                </p>
                <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="email"
                    value={subscribeEmail}
                    onChange={e => setSubscribeEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="flex-1 px-4 py-3 text-lg bg-white text-black font-semibold focus:outline-none"
                    required
                  />
                  <button
                    type="submit"
                    className="px-8 py-3 bg-[#FF6B00] text-white font-black uppercase tracking-wider hover:bg-white hover:text-black transition-colors"
                  >
                    Subscribe
                  </button>
                </form>
              </>
            )}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t-2 border-black py-4 px-4 text-center">
        <p className="text-xs uppercase tracking-widest text-black/40 font-semibold">
          Data from NYC Department of Buildings &middot; Updated daily &middot; <a href="/pressure" className="hover:text-[#FF6B00]">Pressure Gauge &rarr;</a>
        </p>
      </footer>
    </main>
  )
}
