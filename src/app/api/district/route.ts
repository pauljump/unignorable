import { NextRequest, NextResponse } from "next/server"
import { findCouncilDistrict } from "@/lib/district-lookup"

export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get("lat") || "")
  const lng = parseFloat(req.nextUrl.searchParams.get("lng") || "")

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "Missing lat/lng" }, { status: 400 })
  }

  const district = await findCouncilDistrict(lat, lng)

  if (!district) {
    return NextResponse.json({ error: "Not in a NYC council district" }, { status: 404 })
  }

  return NextResponse.json({ district })
}
