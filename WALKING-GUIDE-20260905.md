# Curbnote walking guide · September 5, 2026

Curbnote’s own instructions are the primary walking experience. Paul reported that opening a generated walk in Google or Apple Maps did not populate correctly and authorized investing in our own walking instructions when the handoff cannot preserve the walk.

## Decision and evidence

A directions URL requests a route between locations; it does not import Curbnote’s generated geometry or custom avoidance polygons. The old exporter added sampled geometry as stops and put the intentional stop before them, which could request backtracking instead of the original walk. Google explicitly documents that some clients ignore waypoints. The Apple unified URL used by the old exporter requires iOS 18.4+, while Curbnote supports iOS 17. Neither product’s documented URL parameters transport our turn instructions.

- [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)
- [Apple unified Maps URLs](https://developer.apple.com/documentation/mapkit/unified-map-urls)
- [Apple compatible map links](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html)

Walking handoffs now use simple endpoint links, Apple `saddr`/`daddr`/`dirflg=w`, and Google `api=1`/`origin`/`destination`/`travelmode=walking`. A selected stop gets two explicitly labeled legs. No sampled shape points are sent for walking. These links sit behind “Plan separately in another map” and state that those apps calculate a new route without Curbnote avoidance.

## Delivered behavior

- Web and native show the current instruction, its position on the generated route, the next instruction, Back/Next, the complete instruction list and optional read-aloud.
- The guide advances when the person taps Next. Native progress survives closing/reopening the guide and resets when the route changes; web progress survives reopening the same route and resets for replacement routes.
- The router’s departures, actual turns, crossings, stairs, stops and arrival survive normalization. Only identical straight continuations can merge. The old 80-input/32-output caps and broad “follow the highlighted route” compression are removed.
- The native guide uses SwiftUI and MapKit. The web guide leaves map space above its compact bottom panel and highlights the current step there. Missing maneuver data does not fabricate a walk.
- This is a manual step guide with optional speech, not automatic GPS progress or background navigation. That remains an explicit future product decision.

## Verification and release

All 67 web/backend tests pass, including long-walk arrival retention, exact handoff coordinates/mode, separate stop legs, guide navigation, map framing, progress reset and missing-instruction handling. Eleven native unit tests and the live address-to-route-to-guide UI regression pass. The regression opens the native guide, advances to step 2 and returns to step 1. A rendered iPhone guide screen was inspected. Web browser gesture/render verification remains unavailable without a connected browser. The final native layout/navigation run also passes. Publication results follow after TestFlight processing.
