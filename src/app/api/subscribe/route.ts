import { NextRequest, NextResponse } from "next/server"
import { addSubscriber } from "@/lib/db"

export async function POST(req: NextRequest) {
  const { email, district, jobId } = await req.json()

  if (!email || !district) {
    return NextResponse.json({ error: "Missing email or district" }, { status: 400 })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 })
  }

  addSubscriber(email, district, jobId || null)

  return NextResponse.json({ success: true })
}
