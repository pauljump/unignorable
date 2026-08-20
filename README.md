# Unignorable

Unignorable is an NYC-only avoidance map. Browsing public layers is free; paid route access builds a saved, repeat driving or walking route around the layers a visitor selects.

The app says **mapped ALPR cameras or corridors crossed**. It never claims that a camera captured a person or vehicle. “Flock Safety” is shown only when the OpenStreetMap `manufacturer` tag normalizes to Flock Safety; untagged and other-vendor cameras remain ALPR by default.

## Canonical product and merge boundary

- Canonical source and Git history: `/Users/mini-home/projects/unignorable`
- Runtime data: `/Users/mini-home/.local/share/unignorable` through `DATA_DIR`
- Runtime credentials: `/Users/mini-home/.secrets` through the control-plane runner
- `/Users/mini-home/projects/consent-atlas` and `/Users/mini-home/Desktop/Monorepo/sidewalk` are read-only source references for this consolidation. Their Git histories, files, and runtime state are not merged, moved, archived, or deleted.
- Legacy campaigns, receipts, moderation, hotspots, and issue APIs remain addressable, but the root and `/map` now serve the awareness map.

## Architecture

The shared backend remains dependency-free Node 22. The web client uses self-hosted Leaflet; the iPhone client is native SwiftUI + MapKit.

```text
index.html                    full-screen Leaflet map, autocomplete, driving/walking, exact GPX export
ios/                          native iPhone app, XcodeGen project, MapKit canvas and SwiftUI controls
server.js                     static app, geocode/route proxies, scoring endpoints, legacy routes
map-core.js                   pure route intersection, scoring, recommendation, export URLs
condition-model.js            probabilistic encampment presence and routing confidence
config/nyc-boroughs.geojson  official NYC borough geometry used for exact city-scope checks
scripts/refresh-map-data.js   Overpass + server-side Socrata aggregation → map-layers.json
tests/fixtures/               deterministic map, upstream, and Campaign 001 fixtures
$DATA_DIR/map-layers.json     generated public map artifact; never committed
```

### Data flow

1. The refresh queries OpenStreetMap Overpass (with a second public mirror on transient failure) for nodes tagged `surveillance:type=ALPR`, then filters the regional query through NYC's official borough geometry. It retains coordinates, source links, optional operator fields, and a manufacturer normalized only from the manufacturer tag.
2. The daily local NYC 311 mirror builds encampment sites at coordinates rounded to four decimals (roughly 11 m), while disclosing a 35–45 m location uncertainty because 311 coordinates are address geocodes rather than GPS observations. Homeless Person Assistance requests are not presented as tent evidence. Other civic categories remain compact recurring clusters.
3. Old encampment sites with no meaningful current evidence are omitted. Fresh negative checks remain briefly visible for explanation but are never route exclusions.
4. The refresh writes atomically. If one source fails, its last successful layer and original freshness timestamp remain. If both fail on a first run, no empty artifact is created.
5. Event-level public 311 records feed a versioned latent-state model. Distinct NYC-local report days, direct public-agency observations, imperfect not-found checks, temporary actions, and evidence age update a model score. Evidence relaxes toward uncertainty with a 10-day half-life; duplicate same-day reports are heavily discounted. A closed ticket and the generic “condition was corrected” disposition never mean durable removal. Encampment features also expose a beta shadow score, heuristic score range, evidence-strength tier, and disclosed 35–45 m spatial uncertainty. These are not a calibrated probability, confidence interval, or ground-truth claim. An optional three-hour “most often reported” window appears only for moderate or strong patterns across at least eight recent report days. Each day contributes one total unit distributed across its reported hours, so all-day, diffuse, weak, or disconnected tied patterns are omitted. The window describes historical report timing, not a proven presence schedule.
6. `/api/map-layers` serves the compact artifact. `/api/routes` makes one primary Valhalla request with alternate routes, scores every candidate against selected locations, then makes at most one compact hard-exclusion request around the highest-confidence conflicts. If the avoidance request cannot return a plausible corridor, the already-verified base route remains available. It rechecks every returned line against the wider evidence buffers and chooses the fewest selected crossings first, then evidence-weighted risk, then time/distance. Walking forces ferry avoidance and rejects candidates over a 30% time or 35% distance premium. An optional `via` place creates a real intermediate stop. Address selection, stop, mode, and filter changes reroute automatically; identical requests use a bounded 45-second server cache.
7. The native client keeps Apple MapKit as the map canvas while drawing the exact backend-selected GeoJSON route as a native overlay. It uses the same geocoding, map-layer, routing, maneuver, export, and live Citi Bike endpoints as the web client; Apple does not recalculate the in-app route. Tapping a bike station adds it as an intermediate stop without replacing the destination. Turn-by-turn instructions, route outcomes, and Apple/Google continuation links share the same response contract. At close zoom, a person physically near an encampment point can submit “Still here,” “Gone,” or “Can’t tell.” The server proximity-checks and deduplicates the submission without storing raw trip history, labels it `community_unreviewed`, and saves it for review. Community submissions never change condition scores, shadow forecasts, generated map probabilities, route ranking, or hard exclusions.

Current route buffers are 45 m for mapped ALPR points, 55 m for address-level encampment sites, and 110 m for broad recurring 311 clusters. Only high-scoring encampment sites with recent public-record corroboration are hard exclusions; uncertain sites can influence route ranking, and likely-absent sites have zero routing effect.

## Commands

```bash
# deterministic verification; does not call live map/geocode/route services
npm run verify

# generate and compile the native iPhone project
cd ios && xcodegen generate
xcodebuild -project Unignorable.xcodeproj -scheme Unignorable \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/unignorable-ios-derived CODE_SIGNING_ALLOWED=NO build-for-testing

# refresh only the compact public map artifact
DATA_DIR=/Users/mini-home/.local/share/unignorable npm run refresh:map

# run the forward-corroboration and disposition-drift audit against the local 311 mirror
npm run evaluate:condition

# run locally with existing runtime data
DATA_DIR=/Users/mini-home/.local/share/unignorable \
REVIEW_KEY=test-only-key PORT=8000 npm start
```

`NYC_OPEN_DATA_APP_TOKEN` is optional and, when present in the process environment, raises Socrata limits. `TRUST_PROXY_HEADERS=1` may be set only when a trusted proxy is the sole ingress and overwrites `CF-Connecting-IP`; otherwise the app rate-limits by the direct socket address. No project-local `.env` is used.

## Public endpoints

- `GET /api/map-layers` — free compact layer artifact and per-layer freshness
- `GET /api/geocode?q=…` — NYC-bounded Nominatim proxy with a small in-memory cache
- `GET /api/access` — signed route-pass status and public prices
- `POST /api/checkout` — user-triggered Stripe Checkout for a one-time $1/24-hour pass or one-time $25/year pass
- `POST /api/routes` — paid driving or walking avoidance candidates, optional intermediate stop, verified selected-layer intersections, maneuvers, and map exports
- `POST /api/condition-observations` — proximity-checked, deduplicated community submission saved as unreviewed material; it does not change the forecast

The route request accepts only `alpr`, `homelessness`, `drugs`, `dumping`, `sidewalk`, `street`, and `signals`. Homelessness and drug points are aggregated report clusters, never identified individuals. Popups say NYPD or DHS responded only when public 311 resolution text explicitly says so.

## Limitations and privacy

- ALPR coverage is community-maintained, incomplete, and potentially stale.
- A 311 report is not proof that a condition is present now. The beta shadow score is uncalibrated, its range is heuristic rather than a confidence interval, and neither public records nor unreviewed community submissions establish exact real-time presence.
- Public Nominatim receives typed address searches. Requests are debounced in the browser, cached, and serialized server-side. Public Valhalla receives origin/destination coordinates and selected exclusion polygons/points. Apple Maps or Google Maps receives a trip only when the visitor chooses an export link.
- Regular-route addresses, mode, and filters persist only in browser local storage; the server does not maintain a trip history. Manual A→B entry works without geolocation permission.
- Google and Apple unified Maps exports receive an intentional stop plus a mobile-safe maximum of three total waypoints. Both can recalculate; the in-app line and downloaded GPX remain exact.

The paywall remains deliberately bypassed in production until a live-mode Stripe secret is added to the central vault; all currently inventoried Stripe keys are test-mode. Never point public checkout at a test credential.
