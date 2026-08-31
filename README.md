# Unignorable

Unignorable is a real-time accountability loop for recurring civic conditions. It detects what is likely at an approximate place from public evidence, recruits nearby checks, turns the durable record into accountable action, and tracks whether the outcome holds. The map, walking routes, share receipts, and campaigns are acquisition or action surfaces around that one condition lifecycle—not separate products.

The objective function is **verified resolved condition-days per active block**, subject to calibration, privacy, and non-harm constraints. The operational proxy stack is: forecast calibration → useful nearby checks → reviewed evidence → accountable actions with receipts → independently confirmed, durable outcomes. Raw reports, clicks, shares, and route starts are diagnostics, not the goal.

The app says **mapped ALPR cameras or corridors crossed**. It never claims that a camera captured a person or vehicle. “Flock Safety” is shown only when the OpenStreetMap `manufacturer` tag normalizes to Flock Safety; untagged and other-vendor cameras remain ALPR by default.

## Canonical product and merge boundary

- Canonical source and Git history: `/Users/mini-home/projects/unignorable`
- Runtime data: `/Users/mini-home/.local/share/unignorable` through `DATA_DIR`
- Runtime credentials: `/Users/mini-home/.secrets` through the control-plane runner
- `/Users/mini-home/projects/consent-atlas` and `/Users/mini-home/Desktop/Monorepo/sidewalk` are read-only source references for this consolidation. Their Git histories, files, and runtime state are not merged, moved, archived, or deleted.
- Legacy campaigns, receipts, moderation, hotspots, and issue APIs remain addressable, but the root and `/map` now serve the awareness map.

## Current release snapshot (2026-08-29)

The active product thesis is **close the loop**: Unignorable should say what is likely here, where, and when; expose the next useful transition; and keep the condition visible until people confirm an outcome. The map is the arrival screen. Every forecast opens the same four-state object: **Detected → Checked → Action → Outcome**.

- **Web is live** at [unignorable.polyfeeds.dev](https://unignorable.polyfeeds.dev). The default mobile and desktop view is an unobstructed map with a small dock for forecast search, walking avoidance, and optional source layers.
- **Walking route avoidance remains available.** Tapping the walking control opens the route planner in Walking mode and selects the condition layer needed for avoidance. Directions fields have explicit clear controls.
- **Forecast and data windows are opt-in.** The forecast card opens from search or the map forecast point; source layers open from the layers control. Saved layer selections do not repopulate the launch map.
- **Current web release:** the condition accountability loop is deployed from branch `deploy/prediction-first-20260821`; production uses the keyless OpenStreetMap standard tile layer with visible attribution.
- **WebMCP is implemented locally:** compatible agent browsers discover four top-level site tools for nearby evidence search, condition inspection, current-context reading, and human-controlled next-step preparation. The tools reuse the visible map and existing APIs; they never submit observations, contact officials, start checkout, or publish.
- **Rollback:** branch `backup/pre-prediction-first-20260820` preserves the pre-prediction-first version. Runtime data remains outside Git at `/Users/mini-home/.local/share/unignorable`.
- **Verification:** the client checks pass and the full suite passes 39/39 when run with the production runtime data directory. Deployment is managed through the control-plane fleet registry.
- **iOS:** the native SwiftUI + MapKit client has a successful unsigned archive and passing unit/UI checks. It is not yet in TestFlight or the App Store; remaining release work is signing, privacy URL, and the StoreKit/paywall decision.

The immediate validation is a one-block canary: measure whether forecast viewers complete a nearby check, whether reviewed checks convert into a tracked action, and whether the campaign produces a durable confirmed outcome. Walking is one evidence-recruitment channel; it is not the product's identity. Location-triggered prompts remain an explicit opt-in native follow-up, not background tracking by default.

Atlanta is currently an evidence-foundation extension rather than a second live map. The HB 295 interpretation, conservative evidence checklist, ATL311 source investigation, historical GitHub sources, and recommended Open Records path are documented in [ATLANTA-EXTENSION.md](./ATLANTA-EXTENSION.md).

## Architecture

The shared backend remains dependency-free Node 22. The web client uses self-hosted Leaflet; the iPhone client is native SwiftUI + MapKit.

```text
index.html                    full-screen Leaflet map, autocomplete, driving/walking, exact GPX export
webmcp.js                     page-native WebMCP tool registration and narrow safety contracts
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
7. The native client keeps Apple MapKit as the map canvas while drawing the exact backend-selected GeoJSON route as a native overlay. It uses the same geocoding, map-layer, routing, maneuver, export, and live Citi Bike endpoints as the web client; Apple does not recalculate the in-app route. Tapping a bike station adds it as an intermediate stop without replacing the destination. Turn-by-turn instructions, route outcomes, and Apple/Google continuation links share the same response contract. At close zoom, a person physically near an encampment point can submit “Still here,” “Gone,” or “Can’t tell.” The server proximity-checks and deduplicates the submission without storing raw trip history, labels it `community_unreviewed`, and saves it for review.
8. `/api/condition-loop` joins the forecast to its nearest compatible public Issue, proximity-check summary, approved community verdict, campaign, and action receipts. The moderation queue can approve or reject proximity checks. Approval changes provenance to `community_reviewed`; it still does not mutate a forecast. Reviewed checks become a governed calibration set for a later versioned evaluation, preserving a clean boundary between feedback and production output.

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
- `GET /api/condition-loop?feature_id=…` — one condition's Detected → Checked → Action → Outcome state and next useful action
- `POST /api/condition-observations` — proximity-checked, deduplicated community submission saved as unreviewed material; it does not change the forecast

## WebMCP site tools

When `document.modelContext` is available, the top-level map registers four imperative WebMCP tools:

- `unignorable_find_nearby` — read-only search across seven public evidence categories near an NYC place.
- `unignorable_inspect_condition` — centers the visible map on one modeled condition and returns its evidence, uncertainty, lifecycle, and public URLs.
- `unignorable_read_current_condition` — reads the map and lifecycle currently selected by the person or agent.
- `unignorable_prepare_condition_action` — opens the visible nearby-check, share-receipt, accountability-record, or walking-route interface for a person to complete.

The action tool is intentionally preparation-only. WebMCP cannot assert that a condition is present, request geolocation, submit a community check, contact an official, create an action receipt, purchase route access, copy text, or post to a social network. Public and community-derived output is marked as untrusted content. See [WEBMCP-SUBMISSION.md](./WEBMCP-SUBMISSION.md) for the challenge narrative and demo runbook.

The route request accepts only `alpr`, `homelessness`, `drugs`, `dumping`, `sidewalk`, `street`, and `signals`. Homelessness and drug points are aggregated report clusters, never identified individuals. Popups say NYPD or DHS responded only when public 311 resolution text explicitly says so.

## Limitations and privacy

- ALPR coverage is community-maintained, incomplete, and potentially stale.
- A 311 report is not proof that a condition is present now. The beta shadow score is uncalibrated, its range is heuristic rather than a confidence interval, and neither public records nor unreviewed community submissions establish exact real-time presence.
- Public Nominatim receives typed address searches. Requests are debounced in the browser, cached, and serialized server-side. Public Valhalla receives origin/destination coordinates and selected exclusion polygons/points. Apple Maps or Google Maps receives a trip only when the visitor chooses an export link.
- Regular-route addresses, mode, and filters persist only in browser local storage; the server does not maintain a trip history. Manual A→B entry works without geolocation permission.
- Google and Apple unified Maps exports receive an intentional stop plus a mobile-safe maximum of three total waypoints. Both can recalculate; the in-app line and downloaded GPX remain exact.

The paywall remains deliberately bypassed in production until a live-mode Stripe secret is added to the central vault; all currently inventoried Stripe keys are test-mode. Never point public checkout at a test credential.
