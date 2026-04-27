import { NextRequest, NextResponse } from "next/server"
import { recordClick, getClickCount } from "@/lib/db"

export async function POST(req: NextRequest) {
  const { district, jobId } = await req.json()

  if (!district || !jobId) {
    return NextResponse.json({ error: "Missing district or jobId" }, { status: 400 })
  }

  recordClick(district, jobId)
  const weekCount = getClickCount()

  return NextResponse.json({ weekCount })
}

export async function GET() {
  const weekCount = getClickCount()
  return NextResponse.json({ weekCount })
}
