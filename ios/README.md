# Unignorable for iPhone

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
