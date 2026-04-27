import { StalledProject } from "./stalled-projects"

export interface StallReason {
  headline: string
  detail: string
  severity: "critical" | "high" | "medium"
}

export interface StallAnalysis {
  reasons: StallReason[]
  timeline: TimelineEvent[]
  summary: string
}

export interface TimelineEvent {
  date: string
  label: string
  status: "complete" | "stalled" | "missing"
}

export function analyzeStall(project: StalledProject): StallAnalysis {
  const reasons: StallReason[] = []
  const timeline: TimelineEvent[] = []

  // Build timeline from available dates
  if (project.preFilingDate) {
    timeline.push({
      date: project.preFilingDate,
      label: "Application filed with DOB",
      status: "complete",
    })
  }

  if (project.approvedDate) {
    timeline.push({
      date: project.approvedDate,
      label: "Plans approved by DOB",
      status: "complete",
    })
  }

  if (project.fullyPermittedDate) {
    timeline.push({
      date: project.fullyPermittedDate,
      label: "Permits issued",
      status: "complete",
    })
  }

  // Add the stall point
  if (project.latestActionDate) {
    timeline.push({
      date: project.latestActionDate,
      label: "Last recorded activity",
      status: "stalled",
    })
  }

  // Add "today" as the gap
  timeline.push({
    date: new Date().toLocaleDateString("en-US"),
    label: `${project.yearsStalled} years of silence`,
    status: "missing",
  })

  // Analyze reasons based on status
  switch (project.status) {
    case "3": // SUSPENDED
      reasons.push({
        headline: "Project explicitly suspended by DOB",
        detail: "The Department of Buildings has suspended this project. This typically happens due to outstanding violations, safety concerns, or failure to comply with DOB requirements. The developer must resolve these issues before work can resume.",
        severity: "critical",
      })
      break

    case "Q": // PARTIAL PERMIT
      reasons.push({
        headline: "Only partial permits issued — full approval never granted",
        detail: `This project received partial permits but was never fully permitted. This often indicates issues with specific aspects of the plans — structural, fire safety, or zoning objections that were never resolved. The developer has ${project.yearsStalled} years of permits sitting incomplete.`,
        severity: "high",
      })
      break

    case "R": // FULLY PERMITTED but stalled
      reasons.push({
        headline: "Fully permitted but construction stopped",
        detail: "This project has all its permits but construction has not progressed. Common reasons include: developer ran out of funding, construction liens, contractor disputes, or the developer is holding the site as a speculative asset rather than building.",
        severity: "high",
      })
      break

    case "P": // APPROVED but never permitted
      reasons.push({
        headline: "Plans approved but permits never pulled",
        detail: `DOB approved the plans ${project.yearsStalled} years ago, but the developer never obtained building permits. This suggests the developer may have abandoned the project, lost financing, or is waiting for market conditions to change — while the approved housing remains unbuilt.`,
        severity: "high",
      })
      break

    case "H": // STUCK IN PLAN REVIEW
      reasons.push({
        headline: "Stuck in DOB plan review",
        detail: "This project has been in the plan examination process for an unusually long time. It may be cycling through objections and resubmissions, or it may have been effectively abandoned by the applicant without formally withdrawing.",
        severity: "medium",
      })
      break

    case "F": // ASSIGNED TO EXAMINER
      reasons.push({
        headline: "Assigned to plan examiner — never advanced",
        detail: "This application was assigned to a DOB plan examiner but has not advanced to approval. It may be waiting for the applicant to respond to examiner comments, or it may have fallen through the cracks in the review process.",
        severity: "medium",
      })
      break

    default:
      reasons.push({
        headline: `Status: ${project.statusDescription}`,
        detail: `This project has been in "${project.statusDescription}" status with no recorded progress for ${project.yearsStalled} years.`,
        severity: "medium",
      })
  }

  // Add time-based reasons
  if (project.yearsStalled >= 5) {
    reasons.push({
      headline: `${project.yearsStalled} years without any DOB activity`,
      detail: "Projects stalled this long are often effectively abandoned. The original developer may have sold the site, gone bankrupt, or simply walked away. Meanwhile, the Department of Buildings has no mechanism to force construction to resume or to revoke stale permits.",
      severity: "critical",
    })
  } else if (project.yearsStalled >= 3) {
    reasons.push({
      headline: `${project.yearsStalled} years of inactivity`,
      detail: "Three or more years without activity is a strong signal that this project faces serious obstacles — financial, legal, or regulatory. Without intervention, stalled projects at this stage rarely restart on their own.",
      severity: "high",
    })
  }

  // Add unit-based context
  if (project.units >= 50) {
    reasons.push({
      headline: `${project.units} homes not being built`,
      detail: `In a city with a 1.4% vacancy rate, ${project.units} unbuilt housing units is not a minor issue. This single stalled project could house over ${Math.floor(project.units * 2.5)} people based on NYC's average household size.`,
      severity: "high",
    })
  }

  // Build summary
  const summary = buildSummary(project, reasons)

  return { reasons, timeline, summary }
}

function buildSummary(project: StalledProject, reasons: StallReason[]): string {
  const critical = reasons.filter(r => r.severity === "critical").length
  if (critical > 0) {
    return `This ${project.units}-unit project at ${project.address} has been stalled for ${project.yearsStalled} years with critical issues. Your Council Member can request a DOB investigation and push for resolution.`
  }
  return `This ${project.units}-unit project at ${project.address} has shown no progress in ${project.yearsStalled} years. Your Council Member has the authority to inquire with DOB and the developer about what's blocking construction.`
}
