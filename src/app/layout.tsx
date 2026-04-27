import "./globals.css"
import { Barlow_Condensed } from "next/font/google"

const font = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
})

export const metadata = {
  title: "UNIGNORABLE — NYC Housing Email Cannon",
  description: "One tap sends a real email from YOUR inbox to your City Council Member about stalled housing in your district.",
  openGraph: {
    type: "website",
    title: "UNIGNORABLE",
    description: "NYC residents are emailing their Council Members about stalled housing. Join them.",
  },
  twitter: {
    card: "summary_large_image",
    title: "UNIGNORABLE",
    description: "NYC residents are emailing their Council Members about stalled housing. Join them.",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={font.className}>
        {children}
      </body>
    </html>
  )
}
