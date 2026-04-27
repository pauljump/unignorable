import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")

  if (!address) {
    return NextResponse.json({ error: "Missing address parameter" }, { status: 400 })
  }

  const res = await fetch(
    `https://geosearch.planninglabs.nyc/v2/search?text=${encodeURIComponent(address)}&size=1`
  )

  if (!res.ok) {
    return NextResponse.json({ error: "Geocoding failed" }, { status: 502 })
  }

  const data = await res.json()

  if (!data.features || data.features.length === 0) {
    return NextResponse.json({ error: "Address not found" }, { status: 404 })
  }

  const feature = data.features[0]
  const [lng, lat] = feature.geometry.coordinates
  const borough = feature.properties.borough
  const label = feature.properties.label

  return NextResponse.json({ lat, lng, borough, label })
}
