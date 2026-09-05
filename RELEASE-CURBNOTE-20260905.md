# Curbnote rebrand release · September 5, 2026

Curbnote replaces the Unignorable public identity. Paul selected the name, created App Store Connect record 6809025615 (`com.curbnote.app`, SKU `curbnote`), and selected `curbnote.polyfeeds.dev` as the interim web target before purchasing `curbnote.xyz`. Yellow was rejected; the delivered brand uses mint, deep green and warm paper.

All 52 web/backend tests pass, including public PNG dimensions, configured canonical metadata, manifest delivery, old-host redirects, and legacy API access. App/icon and both social-card PNGs were rendered and visually inspected. No connected browser is available, so a web-browser visual pass is not claimed.

The initial native run compiled and passed model, feedback and planner checks, but the map-pinch test failed because the new hostname was not yet connected and map evidence did not load. Final native verification and live publication results will be appended after deployment.

The source root, runtime databases, process identity and GitHub repository are unchanged. The shared assets and release identifiers are documented in [BRAND.md](./BRAND.md). The old public hostname will redirect browser links while keeping existing API clients working.
