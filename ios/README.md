# Curbnote native release identity

**TestFlight:** 1.0.0 (8) is processed and available to Paul in Curbnote Internal. The Aqua Terminal ship method resolved headless signing; see [the release record](../RELEASE-CURBNOTE-20260905.md).

Native map snapshots, active walk/progress and recent addresses now persist locally. Optional passkey accounts gate only explicit cross-device saves; see [the speed and accounts release](../SPEED-ACCOUNTS-20260905.md). Walking and feedback remain anonymous.
The primary walking action is **Walk with Curbnote**: complete maneuver steps, a map of the active instruction, Back/Next, optional read-aloud and the full list. External maps are secondary route planners; see [the guide decision and verification](../WALKING-GUIDE-20260905.md).

Display name: Curbnote. Bundle ID: `com.curbnote.app`. App Store Connect ID: `6809025615`; SKU: `curbnote`. API and shared links: `https://curbnote.polyfeeds.dev`. The native API client retries a DNS-resolution failure once through the retained `https://unignorable.polyfeeds.dev/api/` alias to the same backend. Ambiguous transport failures and HTTP errors are not retried.

Civic evidence layers start visible independently of walking avoidance; cameras remain opt-in. Double-tap the map or a marker to zoom. Only a single tap on an actual marker opens map details; tapping empty map space does not select a nearby record.

Walking address entry uses Apple's [native search completer](https://developer.apple.com/documentation/mapkit/mklocalsearchcompleter) with the existing geocoder as a three-second fallback if native completion stalls. Suggestions appear immediately below the fields, and selecting one resolves its coordinates before routing. The Xcode project/scheme/module remain `Unignorable` for source continuity. Branding: [../BRAND.md](../BRAND.md). Use `python3 ../scripts/build-brand.py` from this directory to rebuild all shared assets.

## Ship to TestFlight from an agent session

Use `ios/ship-testflight.sh`, following the canonical [TestFlight playbook](../../_factory/brain/playbooks/ios-testflight.md). It reads ASC IDs from the vault, verifies the app and build number, archives, validates the embedded identity, and exports/uploads for internal TestFlight. Each run uses a new artifact directory and refuses an already-uploaded build number. The Mini has Python 3 with PyJWT, Xcode and XcodeGen installed.

When headless signing returns `errSecInternalComponent`, launch the script through a Terminal `.command` file using `open`, as the playbook describes. The existing logged-in Aqua session can access the signing key. **Do not treat this error as proof that Paul must unlock the keychain or provide a password.** Both archive and export receive the vault's ASC authentication flags.

After an upload, query App Store Connect for processing state and beta-group availability. Upload completion alone does not establish installability. The shipping script does not create tester invitations or public links.

The earlier instructions below are historical where they mention the previous public name, bundle identifier or URL.

# Unignorable for iPhone

The September 5 launch is a native SwiftUI + MapKit walking companion: **Know your walk. Improve your block.** It shares walking routes, optional avoidance, block evidence, nearby checks, canonical record links and feedback with the web app. `RecordsView` and `FeedbackView` are native forms and lists. Feedback receipts use app preferences; UserDefaults purpose is declared in the privacy manifest. Free early access uses the existing backend bypass; StoreKit is deferred until repeat value is established. Privacy and support are `/privacy` and `/support` on the canonical host.

Read [the launch decision](../LAUNCH-DECISION.md) and [release status](../RELEASE-20260905.md). Historical implementation notes follow; their older positioning and paywall release gate are superseded.


Native, walking-only SwiftUI + MapKit client for the existing Unignorable NYC service. The opening experience is the map plus one nearby qualitative condition forecast. Each condition exposes the same product loop as the web: Detected → Checked → Action → Outcome, with one next useful action. Walking is an evidence-recruitment and avoidance surface around that loop, not a separate product identity. Uncalibrated numeric model scores and heuristic score ranges remain behind disclosure; they are never described as empirical probabilities or confidence intervals. Stronger historical report-time patterns may appear separately and never claim when people will be present.

The walking planner, filters, raw public-record dots, supplemental map layers, reports, and methodology remain available through progressive disclosure. The planner flow is: enter or resolve both addresses, choose what to avoid, optionally choose something useful to pass on the way, then tap **Create walking route**. Address suggestions use native MapKit search first and retain the API geocoder as a fallback. Editing either address invalidates the old route, while changing preferences updates an existing route automatically.

After generation, **Apple Maps** and **Google Maps** are the primary route-card actions. Unignorable remains available for the exact generated line, contextual map layers, reports, and simplified directions; external map apps receive walking mode, the intentional stop, and bounded shaping points and may refine the line.

All optional avoidance filters and supplemental map layers default off, including license plate cameras. A new walk starts as a normal walking route; people explicitly add only the conditions they care about. Accountability/report records remain native context on the shared map and are not a route-avoidance default.

## Open and run

```sh
cd ios
xcodegen generate
open Unignorable.xcodeproj
```

Choose an iPhone simulator or a signed device and run the `Unignorable` scheme. The default API host is `https://unignorable.polyfeeds.dev` in `APIClient.swift`.

The current prototype expects route access to be enabled by the backend. StoreKit purchase and receipt-based route entitlement are the next product slice; they should replace—not duplicate—the web checkout cookie mechanism.

`PrivacyInfo.xcprivacy` declares no tracking, user-submitted photos and report text as unlinked data used for app functionality, and no required-reason API categories. Route coordinates are used to service a request without retained trip history, and verification coordinates are proximity-checked then discarded. Re-audit the manifest and App Store privacy answers whenever persistence, analytics, SDKs, accounts, or advertising are added.

The source tree includes a valid, code-native 1024×1024 App Store icon in the dark/coral product palette. It is deliberately simple and can be replaced in the `AppIcon` asset catalog when final brand art is approved.

Release work still requiring product or account input: publish a privacy-policy URL, configure StoreKit/server-verified entitlement if route access is paid, prepare screenshots and listing copy, create a signed distribution archive, and complete TestFlight testing on physical devices.
