export interface StalledProject {
  jobId: string
  borough: string
  address: string
  units: number
  stories: number
  status: string
  statusDescription: string
  description: string
  councilDistrict: number
  lat: number
  lng: number
  owner: string
  preFilingDate: string | null
  approvedDate: string | null
  fullyPermittedDate: string | null
  latestActionDate: string | null
  yearsStalled: number
}

interface RawDOBJob {
  job__: string
  borough: string
  house__: string
  street_name: string
  proposed_dwelling_units: string
  proposed_no_of_stories: string
  job_status: string
  job_status_descrp: string
  latest_action_date: string
  pre__filing_date: string
  approved: string
  fully_permitted: string
  signoff_date: string
  job_description: string
  gis_council_district: string
  gis_latitude: string
  gis_longitude: string
  owner_s_business_name: string
}

const SODA_BASE = "https://data.cityofnewyork.us/resource/ic3t-wcy2.json"

function parseDate(d: string | undefined): Date | null {
  if (!d) return null
  // Handle both "MM/DD/YYYY" and "YYYY-MM-DD" formats
  const cleaned = d.trim()
  if (cleaned.includes("/")) {
    const [m, day, y] = cleaned.split("/")
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(day))
  }
  return new Date(cleaned)
}

function yearsSince(dateStr: string | undefined): number {
  const d = parseDate(dateStr)
  if (!d || isNaN(d.getTime())) return 0
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
}

function isStalled(job: RawDOBJob): boolean {
  const status = job.job_status
  const latestAction = parseDate(job.latest_action_date)
  const now = new Date()
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate())

  // Explicitly suspended
  if (status === "3") return true

  // Signed off = complete, not stalled
  if (status === "X") return false

  // Permit issued (full or partial) but no recent activity and no signoff
  if ((status === "R" || status === "Q") && !job.signoff_date) {
    if (latestAction && latestAction < twoYearsAgo) return true
  }

  // Approved but never fully permitted, sitting for 2+ years
  if (status === "P" && !job.fully_permitted) {
    const approved = parseDate(job.approved)
    if (approved && approved < twoYearsAgo) return true
  }

  // Stuck in plan review for 3+ years
  if ((status === "H" || status === "F") && latestAction && latestAction < new Date(now.getFullYear() - 3, now.getMonth(), now.getDate())) {
    return true
  }

  return false
}

export async function fetchStalledProjects(): Promise<StalledProject[]> {
  const params = new URLSearchParams({
    "$where": "job_type='NB'",
    "$select": "job__,borough,house__,street_name,proposed_dwelling_units,proposed_no_of_stories,job_status,job_status_descrp,latest_action_date,pre__filing_date,approved,fully_permitted,signoff_date,job_description,gis_council_district,gis_latitude,gis_longitude,owner_s_business_name",
    "$limit": "50000",
  })

  const res = await fetch(`${SODA_BASE}?${params}`, {
    next: { revalidate: 86400 }, // Cache for 24 hours
  })

  if (!res.ok) {
    throw new Error(`NYC OpenData API error: ${res.status}`)
  }

  const raw: RawDOBJob[] = await res.json()

  return raw
    .filter(job => {
      const units = parseInt(job.proposed_dwelling_units)
      if (isNaN(units) || units < 10) return false
      if (!job.gis_council_district) return false
      return isStalled(job)
    })
    .map(job => ({
      jobId: job.job__,
      borough: job.borough,
      address: `${job.house__} ${job.street_name}`.trim(),
      units: parseInt(job.proposed_dwelling_units),
      stories: parseInt(job.proposed_no_of_stories) || 0,
      status: job.job_status,
      statusDescription: job.job_status_descrp,
      description: job.job_description || "",
      councilDistrict: parseInt(job.gis_council_district),
      lat: parseFloat(job.gis_latitude),
      lng: parseFloat(job.gis_longitude),
      owner: job.owner_s_business_name || "Unknown",
      preFilingDate: job.pre__filing_date || null,
      approvedDate: job.approved || null,
      fullyPermittedDate: job.fully_permitted || null,
      latestActionDate: job.latest_action_date?.trim() || null,
      yearsStalled: yearsSince(job.latest_action_date),
    }))
    .sort((a, b) => b.units - a.units)
}

export function getProjectsByDistrict(projects: StalledProject[]): Map<number, StalledProject[]> {
  const map = new Map<number, StalledProject[]>()
  for (const p of projects) {
    const existing = map.get(p.councilDistrict) || []
    existing.push(p)
    map.set(p.councilDistrict, existing)
  }
  return map
}
