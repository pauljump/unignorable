"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function Home() {
  const [address, setAddress] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [clickCount, setClickCount] = useState<number | null>(null)
  const router = useRouter()

  // Fetch click count on mount
  useState(() => {
    fetch("/api/click")
      .then(r => r.json())
      .then(d => setClickCount(d.weekCount))
      .catch(() => {})
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      // Geocode the address
      const geoRes = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`)
      if (!geoRes.ok) {
        const data = await geoRes.json()
        setError(data.error || "Address not found. Try including borough or zip code.")
        setLoading(false)
        return
      }

      const { lat, lng } = await geoRes.json()

      // Find council district
      const districtRes = await fetch(`/api/district?lat=${lat}&lng=${lng}`)
      if (!districtRes.ok) {
        setError("Could not determine your council district. Try a different address.")
        setLoading(false)
        return
      }

      const { district } = await districtRes.json()
      router.push(`/district/${district}`)
    } catch {
      setError("Something went wrong. Please try again.")
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-white flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        {/* Counter */}
        {clickCount !== null && clickCount > 0 && (
          <div className="mb-8 text-center">
            <div className="text-[8rem] md:text-[12rem] font-black leading-none text-[#FF6B00] tracking-tight">
              {clickCount.toLocaleString()}
            </div>
            <div className="text-lg md:text-xl font-semibold uppercase tracking-widest text-black/60">
              emails sent to NYC Council this week
            </div>
          </div>
        )}

        {/* Headline */}
        <h1 className="text-5xl md:text-7xl lg:text-8xl font-black uppercase text-center leading-[0.9] tracking-tight max-w-4xl mb-8">
          Your Council Member
          <br />
          <span className="text-[#FF6B00]">Can&apos;t Ignore</span>
          <br />
          Your Email
        </h1>

        <p className="text-lg md:text-xl text-black/60 text-center max-w-xl mb-12 font-semibold">
          Enter your NYC address. We&apos;ll show you stalled housing projects
          in your district and help you email your Council Member about them.
          From your inbox. Your name. Unignorable.
        </p>

        {/* Address Input */}
        <form onSubmit={handleSubmit} className="w-full max-w-xl">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Enter your NYC address..."
              className="flex-1 px-4 py-4 text-lg border-2 border-black bg-white text-black placeholder:text-black/30 font-semibold focus:outline-none focus:border-[#FF6B00] uppercase"
              required
            />
            <button
              type="submit"
              disabled={loading || !address}
              className="px-8 py-4 bg-black text-white text-lg font-black uppercase tracking-wider hover:bg-[#FF6B00] transition-colors disabled:opacity-50"
            >
              {loading ? "Finding..." : "Find My Rep"}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-red-600 font-semibold">{error}</p>
          )}
        </form>

        {/* Browse all */}
        <a
          href="/pressure"
          className="mt-8 text-sm uppercase tracking-widest font-bold text-black/40 hover:text-[#FF6B00] transition-colors"
        >
          Or browse all 51 districts &rarr;
        </a>
      </div>

      {/* Footer */}
      <footer className="border-t-2 border-black py-4 px-4 text-center">
        <p className="text-xs uppercase tracking-widest text-black/40 font-semibold">
          Real NYC data. Real emails. Not a petition.
        </p>
      </footer>
    </main>
  )
}
