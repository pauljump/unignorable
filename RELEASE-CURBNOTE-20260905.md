# Curbnote rebrand release · September 5, 2026

## Prediction-only map · build 9

The native map now has one visual language: every condition dot is an approximate homelessness-condition prediction. The separate map-center-driven “Presence forecast” marker and forecast panel are gone, so panning and zooming no longer move a selected forecast. The user’s blue location dot remains the only location marker; tapping any prediction dot opens its own detail and share action.

Verification: 14 native unit tests pass; the native test build succeeds; all 4 focused map UI checks pass, including prediction-dot detail/share and absence of the moving forecast UI. The signed archive passes strict validation and embeds `com.curbnote.app`, Curbnote, version 1.0.0 and build 9.

**Released: Curbnote 1.0.0 (9)** from `3615324` / `70f0b6d`. Apple build ID `133627ff-f666-4178-80c3-ff6ffd94cf6b` is `VALID` in App Store Connect. The internal-only TestFlight upload succeeded through the Aqua Terminal playbook. Source is pushed to `origin/deploy/prediction-first-20260821`.

Artifacts: `/Users/mini-home/.local/share/curbnote-releases/testflight-20260905T224916Z`.

## Map clarity and shareable dots · build 8

The launch map now shows only the user’s blue location dot. Evidence layers remain opt-in, and route endpoints appear only after a route is selected. Tapping an instance dot immediately highlights it and opens its detail sheet. Every map point now has a prominent Share this dot action for X, Messages and other share targets, with uncertainty-preserving copy and a stable public link.

Verification: 72 backend/web tests pass; fourteen native unit tests pass; native build-for-testing succeeds; focused map gesture UI checks pass. The signed archive passes strict validation and embeds `com.curbnote.app`, Curbnote, version 1.0.0 and build 8.

**Released: Curbnote 1.0.0 (8)** from `8f50ba4`. Apple build ID `5672d67f-54f9-4432-ac5e-b38a27e6e948` is `VALID` in App Store Connect. The upload succeeded through the Aqua Terminal playbook for the Curbnote Internal TestFlight group. Source is pushed to `origin/deploy/prediction-first-20260821`.

Artifacts: `/Users/mini-home/.local/share/curbnote-releases/testflight-20260905T222610Z`.

## Local speed and optional passkey accounts · build 7

Native map snapshots, the active walk and step progress, and recent addresses restore from protected local storage. Condition selection and raw-report clustering run off the UI actor; optional report data loads on demand. Accounts are offered at Save this walk across devices. Native passkeys and browser WebAuthn share a private saved-walk library containing only explicitly saved address/stop/preference recipes. Opening a saved walk prepares a fresh route request. Anonymous walking and feedback remain available. Both clients provide sign-out, walk removal, additional passkeys and account deletion. See [the implementation and operating contract](./SPEED-ACCOUNTS-20260905.md).

Verification: 72 backend/web tests and fourteen native unit tests pass. Native UI verifies route creation, optional signup, continuing anonymously, relaunch/resume at step 2, and map gestures. Headless mobile Chromium with a virtual authenticator verifies signup, explicit save, logout/login, real planner restoration and account deletion against isolated data. Final signup/save screenshots were inspected. Native passkey creation on a physical phone remains an acceptance check.

**Released: Curbnote 1.0.0 (7)** from `7610880`. Apple build ID `113f3f55-c01b-4fb4-8f76-abb380c88f4d` is `VALID` and `IN_BETA_TESTING`, with Curbnote Internal access and What to Test notes verified. The signed archive passes strict validation and carries the required Associated Domains entitlement; Apple’s association CDN confirms the matching app identity. Web is live through the fleet/vault runner, with public TLS checks passing. Source is pushed and the portfolio scan completed.

Artifacts: `/Users/mini-home/.local/share/curbnote-releases/testflight-20260905T212341Z`.


## Curbnote walking guide · build 6

Curbnote now owns the primary walking experience on web and native iOS. The guide keeps turns, crossings, stops and arrival, shows each instruction on the generated route, offers Next/Back and optional read-aloud, and resumes when reopened. Progress is manual. The old exporter tried to shape external routes with sampled stops, and instruction compression could hide actual maneuvers. Walking map links now use compatible endpoint parameters and separately labeled stop legs, behind an explanation that Apple and Google calculate a new route. See [the walking-guide decision and evidence](./WALKING-GUIDE-20260905.md).

All 67 web/backend tests and eleven native unit tests pass. The live native address-to-route-to-guide regression passes, including Next and Back; the final rendered iPhone guide was inspected. Web is live from `35b825f`, deployed through the fleet/vault runner and checked over TLS. No connected browser or physical-device walking pass is claimed.

**Released: Curbnote 1.0.0 (6)** from `35b825f`. Apple build ID `add05857-2a72-44db-9d64-a8b6d210d081` is `VALID` and `IN_BETA_TESTING`, with Curbnote Internal access confirmed and English What to Test notes verified. The signed archive passed strict signature validation and the Aqua Terminal upload succeeded. Source is pushed to the canonical branch and the portfolio scan completed.

Artifacts: `/Users/mini-home/.local/share/curbnote-releases/testflight-20260905T200845Z` retains the signed archive, receipt, ship log, successful test logs, inspected guide screenshot, processing/group confirmations and testing notes.


## Map gesture correction · build 5

Paul specified that double-tapping the map must zoom, and map detail sheets should open only from actual instance markers. Web background click and long-press/context-menu handlers no longer select the nearest condition. Route lines are noninteractive; route choices remain in the route UI. Marker single taps defer until a possible double tap is ruled out; a double tap cancels details and zooms at the touched location. Panning cancels pending selections. This applies to modeled civic evidence, supporting evidence, public records, clusters and bike stations. Leaflet background double-tap zoom remains enabled. Map help text now describes this behavior.

Native instance markers now distinguish single from double taps while retaining an accessibility activation action. The native map explicitly converts a double tap into zoom at that coordinate through MapReader; a single background tap has no selection action. The same rule applies to primary forecasts, evidence dots, report markers and bike stations. Record markers no longer rely on automatic MapKit selection to present a sheet.

Verification: all 60 web/backend tests pass. Native UI regression verifies marker double-tap zoom with no sheet, empty-map single tap with no sheet, empty-map double-tap zoom, and a single marker tap opening details. Pinch zoom also passes. Test screenshots are retained. The web fix is live from `f50ce26` through the existing fleet/vault runner; TLS delivery was checked for the removed background handlers and enabled zoom. No connected browser is available for a browser gesture pass.

**Released: Curbnote 1.0.0 (5)** from `67ec9a6`. Apple build ID `99a9a697-0b8f-42c5-991d-7e0208c4100b` is `VALID` and `IN_BETA_TESTING`, with Curbnote Internal access confirmed. English What to Test notes are saved and verified. The signed archive passed strict signature validation and the Aqua Terminal upload completed successfully. Source is pushed to the canonical GitHub branch. The portfolio inventory scan completed.

Artifacts: `/Users/mini-home/.local/share/curbnote-releases/testflight-20260905T194801Z` contains the signed archive, upload receipt, complete ship log, successful web/native gesture test logs, screenshots, Apple processing confirmation, internal-group confirmation and testing notes.


## Map visibility correction · build 3

Paul reported no occurrence dots after leaving walking directions and no visible map reference when a detail opened. Web rendering incorrectly used the route-avoidance set (empty at launch) as the map-visibility set. The phone forecast panel also occupied nearly the full map. Dot events could bubble to the generic nearest-record handler, and late route responses could reopen dismissed results.

The fix gives web and iOS independent visible civic layers at launch while route avoidance remains empty. Cameras remain opt-in. Web adds separate Show on map controls, larger dots, exact dot selection with propagation disabled, a selected-point marker on a separate renderer, and a medium-height mobile sheet with both the tapped point and selected record fitted into the exposed map. Closing directions hides the results, including late arrivals. Native shows the same civic categories by default, makes all evidence dots tappable and larger, and opens details at a medium detent with the selected location above the sheet.

Verification: 57 web/backend tests pass, including five executable regressions for visibility after closing walking, avoidance/visibility independence, direct dot selection, actual tap coordinates, selected-map framing and dismissed-result races. Six native model tests pass, including fixture-based evidence/avoidance independence. Native app and test targets compile. No browser is connected for a web visual inspection; these checks do not substitute for a physical-device walk.

Web fix `a1655bd` is live at `https://curbnote.polyfeeds.dev`, restarted through the fleet/vault runner; TLS delivery and health were verified. Apple processed build 3 (`2545492e-cc60-4dba-9046-4de61a87fc25`) as `VALID` and `IN_BETA_TESTING`. Artifacts: `/Users/mini-home/.local/share/curbnote-releases/testflight-20260905T192051Z`.

## Address search and DNS resilience · build 4

Paul then reported broken native autocomplete and supplied a screenshot of “A server with the specified hostname could not be found.” The new hostname resolves through public DNS, but the same system-resolver failure was reproduced on the Mini. The existing legacy `/api/` host still resolves and serves the same backend. The native API client now retries once through that alias only for a DNS lookup failure, preserving the path, query and request body. It does not retry timeouts, connection loss, HTTP errors, cancellation or arbitrary hosts. The canonical web and sharing origin remains Curbnote.

The UI regression reproduced a separate focus-state bug: the parent map owned the presented planner’s focus state, so typing could bypass the search guard entirely. The planner is now a dedicated SwiftUI view that owns its text-field focus. It uses a persistent native `MKLocalSearchCompleter` for partial addresses and resolves the selected completion to a NYC coordinate. The existing geocoder provides a bounded-delay fallback if native suggestions fail or stall. Suggestions, loading and failure states appear directly below the address fields above route preferences. Selecting, clearing or switching addresses cancels stale work. Preference icons now use mint.

Verification: all ten native unit tests and all five UI tests pass across the focused runs. The live address-entry regression selects both addresses from tappable suggestions above the keyboard, creates a walking route and verifies “Route ready” with no hostname error. The map-marker/pinch test now loads actual backend evidence and passes; the earlier DNS-related UI failure is resolved by the API fallback. Autocomplete and successful-route screenshots were exported and visually inspected. The 57 web/backend checks for the map fix remain passing; build 4 changes only native code and release documentation.

**Released: Curbnote 1.0.0 (4)** from commit `2121859`. Apple build ID `9adb286f-9f3f-48a7-9208-ff84083d7fd7` is `VALID` and `IN_BETA_TESTING`; the Curbnote Internal group has access. English What to Test notes are saved and verified. The signed archive passes strict signature validation, embeds `com.curbnote.app` and build 4, and exported/uploaded successfully through the Aqua Terminal playbook. Code is pushed to `origin/deploy/prediction-first-20260821`.

Artifacts: `/Users/mini-home/.local/share/curbnote-releases/testflight-20260905T193308Z` contains the signed archive, upload receipt, complete ship log, test logs, inspected autocomplete/route screenshots, App Store Connect processing confirmation, group confirmation and testing notes. A physical-device walk remains a user acceptance check; simulator tests did use the live service. The portfolio inventory scan completed after the native correction.


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
