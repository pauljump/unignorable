# Curbnote rebrand release · September 5, 2026

## Map visibility correction · build 3

Paul reported no occurrence dots after leaving walking directions and no visible map reference when a detail opened. Web rendering incorrectly used the route-avoidance set (empty at launch) as the map-visibility set. The phone forecast panel also occupied nearly the full map. Dot events could bubble to the generic nearest-record handler, and late route responses could reopen dismissed results.

The fix gives web and iOS independent visible civic layers at launch while route avoidance remains empty. Cameras remain opt-in. Web adds separate Show on map controls, larger dots, exact dot selection with propagation disabled, a selected-point marker on a separate renderer, and a medium-height mobile sheet with both the tapped point and selected record fitted into the exposed map. Closing directions hides the results, including late arrivals. Native shows the same civic categories by default, makes all evidence dots tappable and larger, and opens details at a medium detent with the selected location above the sheet.

Verification: 57 web/backend tests pass, including five executable regressions for visibility after closing walking, avoidance/visibility independence, direct dot selection, actual tap coordinates, selected-map framing and dismissed-result races. Six native model tests pass, including fixture-based evidence/avoidance independence. Native app and test targets compile. No browser is connected for a web visual inspection; these checks do not substitute for a physical-device walk.

Web fix `a1655bd` is live at `https://curbnote.polyfeeds.dev`, restarted through the fleet/vault runner; TLS delivery and health were verified. Apple processed build 3 (`2545492e-cc60-4dba-9046-4de61a87fc25`) as `VALID` and `IN_BETA_TESTING`. Artifacts: `/Users/mini-home/.local/share/curbnote-releases/testflight-20260905T192051Z`.

## Address search and DNS resilience · build 4

Paul then reported broken native autocomplete and supplied a screenshot of “A server with the specified hostname could not be found.” The new hostname resolves through public DNS, but the same system-resolver failure was reproduced on the Mini. The existing legacy `/api/` host still resolves and serves the same backend. The native API client now retries once through that alias only for a DNS lookup failure, preserving the path, query and request body. It does not retry timeouts, connection loss, HTTP errors, cancellation or arbitrary hosts. The canonical web and sharing origin remains Curbnote.

The UI regression reproduced a separate focus-state bug: the parent map owned the presented planner’s focus state, so typing could bypass the search guard entirely. The planner is now a dedicated SwiftUI view that owns its text-field focus. It uses a persistent native `MKLocalSearchCompleter` for partial addresses and resolves the selected completion to a NYC coordinate. The existing geocoder provides a bounded-delay fallback if native suggestions fail or stall. Suggestions, loading and failure states appear directly below the address fields above route preferences. Selecting, clearing or switching addresses cancels stale work. Preference icons now use mint.

Verification: all ten native unit tests and all five UI tests pass across the focused runs. The live address-entry regression selects both addresses from tappable suggestions above the keyboard, creates a walking route and verifies “Route ready” with no hostname error. The map-marker/pinch test now loads actual backend evidence and passes; the earlier DNS-related UI failure is resolved by the API fallback. Autocomplete and successful-route screenshots were exported and visually inspected. The 57 web/backend checks for the map fix remain passing; build 4 changes only native code and release documentation.

Publication results follow after final region-bound autocomplete verification and Apple processing.


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

## Initial release attempt (historical; superseded above)

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
