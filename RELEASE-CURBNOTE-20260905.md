# Curbnote rebrand release · September 5, 2026

## TestFlight released · September 5, 2026, 19:07 UTC

**Curbnote 1.0.0 (2) has been uploaded and processed successfully.** App Store Connect build ID `bdb6f51b-0290-41de-9fbd-eddfa7d8f723` reports `VALID`, `usesNonExemptEncryption: false`, and internal state `IN_BETA_TESTING`. The Curbnote Internal group includes Paul Jump and build 2. No public link or external testing was enabled. English What to Test notes are saved.

The earlier signing-blocker statements below are historical and resolved. The canonical playbook's **Aqua Terminal `.command` launch** signed and uploaded successfully without unlocking the keychain, handling a password, or changing keychain permissions. Headless `errSecInternalComponent` did not imply that Paul needed to unlock the keychain manually. `ios/ship-testflight.sh` now implements the working archive/export flow with vault ASC authentication on both steps, duplicate-build protection, embedded identity checks, and unique artifact directories.

Native build-2 verification reran all nine tests: five model and three UI tests pass; the map-marker/pinch test still fails while the Mac system resolver retains a negative answer for the new hostname. Public and router DNS now answer correctly, but the normal system resolver remains stale. This follow-up limitation is separate from the verified TestFlight processing/install availability. No claim of a completed physical-device walk is made.

Archive signature validation (`codesign --verify --deep --strict`) passes. The uploaded build embeds Curbnote, `com.curbnote.app`, version 1.0.0, build 2, the mint app icon, HTTPS backend URLs and iPad orientation declarations required by the current SDK. Export returned `EXPORT SUCCEEDED`; Apple completed processing and made the build available to the internal group.

Artifacts: `/Users/mini-home/.local/share/curbnote-releases/testflight-20260905T190535Z` (signed archive, export options, ship log, uploaded receipt and App Store Connect confirmation).


Curbnote replaces the Unignorable public identity. Paul selected the name, created App Store Connect record 6809025615 (`com.curbnote.app`, SKU `curbnote`), and selected `curbnote.polyfeeds.dev` as the interim web target before purchasing `curbnote.xyz`. Yellow was rejected; the delivered brand uses mint, deep green and warm paper.

All 52 web/backend tests pass, including public PNG dimensions, configured canonical metadata, manifest delivery, old-host redirects, and legacy API access. App/icon and both social-card PNGs were rendered and visually inspected. No connected browser is available, so a web-browser visual pass is not claimed.

The initial native run compiled and passed model, feedback and planner checks, but the map-pinch test failed because the new hostname was not yet connected and map evidence did not load. Final native verification and live publication results will be appended after deployment.

The source root, runtime databases, process identity and GitHub repository are unchanged. The shared assets and release identifiers are documented in [BRAND.md](./BRAND.md). The old public hostname will redirect browser links while keeping existing API clients working.

## Final release state

- Deployed code: `7753f56`, fast-forwarded into the canonical `deploy/prediction-first-20260821` checkout. Published with the existing fleet/vault runner; process stays `unignorable-canonical`, port 8000, data unchanged.
- Added the authorized `curbnote.polyfeeds.dev` CNAME and mini-dev tunnel rule. Retained the old hostname. IPv6 remains off. The control-plane origin change is commit `bc6eda2`; unrelated working changes were preserved.
- Verified TLS/HTTP through Cloudflare using the hostname and its publicly resolved A record: health, home, records, privacy, support, manifest and both 1200 × 630 PNGs return successfully. Canonical and OG URLs use Curbnote. The old shared record URL returns 308 with its path/query preserved.
- Public DNS at Cloudflare/1.1.1.1 and Tailscale resolves the hostname. This Mac's system/router resolver still returned the earlier negative result during verification. The native map-pinch check therefore remains unverified; this is not a claim of a complete device/network pass. No host-file or system DNS override was installed.
- Final native suite: 5 model tests and 3 UI tests pass; the network-dependent map-pinch test fails because map evidence cannot load through that cached resolver. Launch and feedback screenshots were exported from XCTest and inspected. The Curbnote wordmark stays on one line; native actions and artwork use mint.
- App Store Connect API confirms **Curbnote**, `com.curbnote.app`, SKU `curbnote`, Apple ID `6809025615`; its build list is empty. No TestFlight upload occurred.
- Signed archive retried with the existing Apple account/API key. Compilation passes, but CodeSign returns `errSecInternalComponent`. Normal login-keychain signing access must be restored on the Mini before export/upload; no credentials or keychain permissions were changed.
- Unsigned archive succeeds. Verified embedded display name **Curbnote**, bundle ID **com.curbnote.app**, version **1.0.0 (1)** and opaque RGB 1024 × 1024 app icon.

Artifacts: `/Users/mini-home/.local/share/curbnote-releases/20260905/` contains `Curbnote-unsigned.xcarchive`, `curbnote-brand-kit.zip`, logs and inspected screenshots. An unsigned archive cannot be uploaded directly to TestFlight; rerun the signed archive and App Store export after restoring key access.

Listing URLs: marketing `https://curbnote.polyfeeds.dev`, support `/support`, privacy `/privacy`. Suggested App Store subtitle remains **Know your NYC walk**. The Curbnote icon is included in the asset catalog and will reach App Store Connect with a successfully uploaded build.
