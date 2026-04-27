import { fetchStalledProjects, StalledProject } from "@/lib/stalled-projects"
import { councilMembers } from "@/data/council-members"
import { DistrictClient } from "./client"

interface Props {
  params: Promise<{ id: string }>
}

export default async function DistrictPage({ params }: Props) {
  const { id } = await params
  const districtNum = parseInt(id)

  if (isNaN(districtNum) || districtNum < 1 || districtNum > 51) {
    return <div className="p-8 text-center text-2xl font-bold">Invalid district number</div>
  }

  const member = councilMembers.find(m => m.district === districtNum)
  if (!member) {
    return <div className="p-8 text-center text-2xl font-bold">Council member not found</div>
  }

  const allProjects = await fetchStalledProjects()
  const projects = allProjects.filter(p => p.councilDistrict === districtNum)

  return <DistrictClient member={member} projects={projects} />
}
