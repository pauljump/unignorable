# Atlanta extension boundary

The first Atlanta slice is an evidence foundation, not a second live map yet.

## Why HB 295 matters

Georgia HB 295 became effective July 1, 2026 and enacted O.C.G.A. § 36-60-34. It lets an eligible real-property owner submit a written compensation claim to a local government when a policy, pattern, or practice of non-enforcement of listed laws, or a maintained public nuisance, causes documented mitigation expenses or a reduction in fair-market value. The statute gives the local government 30 days to act, permits a superior-court action if the claim is rejected or ignored, allows one claim per parcel per tax year, and caps compensation at the prior tax year's local ad valorem property tax.

That is a legal evidence workflow, not a new 311 category. A recurring ATL311 record may help establish chronology or location, but it does not by itself establish a statutory policy/pattern/practice, a public nuisance, causation, damages, or the identity of an offender.

## Current integration seam

- `config/jurisdictions/atlanta.json` records Atlanta's official city-limit and council-district GIS sources, the ATL311 entry point, and the HB 295 claim fields.
- `hb295-evidence.js` turns owner, parcel, request, damage, and tax-year inputs into a conservative attorney-review checklist.
- The checklist intentionally treats a generic `Closed`/`Complete` service-request status as only a status. It does not convert closure into proof of cleanup or lawful enforcement.

## Remaining before a live Atlanta map

1. Verify a bulk ATL311 export and its field semantics; the current public portal is a Power Platform case system and is not assumed to be a stable historical API.
2. Download and pin the official Atlanta city-limits GeoJSON and current council-district geometry from ATL GIS.
3. Define Atlanta-specific request categories and outcome language with a source audit, including what can be safely shown about homelessness, substance use, and public safety.
4. Add parcel/tax records and an owner-supplied expense/value evidence flow only after privacy, legal, and counsel review.
5. Keep the public product framed as evidence organization and accountability; do not advertise guaranteed compensation or legal advice.
