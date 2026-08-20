# Unignorable for iPhone

Native, walking-only SwiftUI + MapKit client for the existing Unignorable NYC routing service. The Apple map is the in-app canvas; exact walking-route geometry, avoidance scoring, alternatives, intermediate stops, maneuver text, accountability records, and continuation links come from the product's `/api` backend. Routing and reporting share one map surface; there is no driving mode or separate Report tab.

The planner is an explicit walking flow: enter or resolve both addresses, choose what to avoid, optionally choose something useful to pass on the way, then tap **Create walking route**. Address suggestions use native MapKit search first and retain the API geocoder as a fallback. Editing either address invalidates the old route, while changing preferences updates an existing route automatically.

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
