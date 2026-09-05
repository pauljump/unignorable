# Curbnote

**Know your walk. Improve your block.**

Curbnote helps you choose an NYC walking route with more context about the blocks along the way. Walking is the immediate utility; dated evidence and reviewed local checks build neighborhood knowledge. Avoid claims of live safety, guaranteed conditions or proven improvement.

## Identity

The open C is a route around a block. The small speech note represents local observations and feedback. The mark has one clear silhouette at app-icon size; it needs no initials, map pin, text or decorative border inside the icon.

- Deep green `#142722`: app icon, primary surfaces, social backgrounds.
- Vivid mint `#72E2BD`: mark, primary actions, emphasis. Paul explicitly rejected yellow.
- Warm paper `#F6F3E9`: wordmark, note, primary text.
- Muted sage `#BBC9C0`: supporting text.
- Curbnote in prose and App Store; `curbnote` in the lowercase wordmark. Native typography uses system fonts.

Warning and source-category colors are separate from the brand. An accent does not classify a street as safe.

## Reusable assets

All source vectors and raster exports live in `assets/brand/`. Run `python3 scripts/build-brand.py` with local `rsvg-convert` to regenerate. No network or image-generation API is used. The iOS icon and in-app mark are generated from the same source. `ios/scripts/generate-app-icon.swift` forwards to this generator.

- `curbnote-icon-v1.png`: opaque 1024 × 1024 iOS icon; the OS supplies corner masking.
- `curbnote-icon-{32,180,192,512}-v1.png`: favicon, Apple touch and web app icons.
- `curbnote-mark-v1.svg`, `curbnote-wordmark-v1.svg`: transparent masters for dark surfaces.
- `curbnote-share-walk-v1.png`: 1200 × 630 app/route launch card.
- `curbnote-share-record-v1.png`: 1200 × 630 block-record card. Generic illustration; specific evidence remains in page title and description.
- `curbnote-social-square-v1.png`: 1080 × 1080 launch artwork.
- `curbnote-v1.css`: shared web branding.

Public pages expose absolute Open Graph / Twitter large-image URLs with dimensions and alt text. Feedback receipts remain noindex and do not put private feedback into social metadata. Asset URLs are versioned for long cache lifetimes. Increment the asset suffix for future published artwork changes.

## Release identity

- Current hostname: `curbnote.polyfeeds.dev`.
- Future hostname: `curbnote.xyz`; not purchased or configured in this task.
- iOS display name: **Curbnote**.
- Bundle ID: **com.curbnote.app**.
- App Store Connect Apple ID: **6809025615**, SKU **curbnote** (user-provided App Store Connect screenshot, September 5, 2026).
- Canonical source stays `/Users/mini-home/projects/unignorable`; existing Git remote, Xcode module/scheme, process, data paths, browser storage keys and integration identifiers are retained to keep this a brand migration rather than a second product.

The web origin is deployment configuration. To adopt curbnote.xyz after purchase, add its authorized tunnel/DNS route, change the fleet PUBLIC_ORIGIN, update native API and shared-link URLs, update deployment metadata, and release a new native build. Browser storage is scoped to each hostname; saved receipt URLs survive redirects, but browser-only preferences cannot automatically transfer across origins.
