# Atlanta extension boundary

The first Atlanta slice is an evidence foundation, not a second live map yet.

## Why HB 295 matters

Georgia HB 295 became effective July 1, 2026 and enacted O.C.G.A. § 36-60-34. It lets an eligible real-property owner submit a written compensation claim to a local government when a policy, pattern, or practice of non-enforcement of listed laws, or a maintained public nuisance, causes documented mitigation expenses or a reduction in fair-market value. The statute gives the local government 30 days to act, permits a superior-court action if the claim is rejected or ignored, allows one claim per parcel per tax year, and caps compensation at the prior tax year's local ad valorem property tax.

That is a legal evidence workflow, not a new 311 category. A recurring ATL311 record may help establish chronology or location, but it does not by itself establish a statutory policy/pattern/practice, a public nuisance, causation, damages, or the identity of an offender.

## Current integration seam

- `config/jurisdictions/atlanta.json` records Atlanta's official city-limit and council-district GIS sources, the ATL311 entry point, and the HB 295 claim fields.
- `hb295-evidence.js` turns owner, parcel, request, damage, and tax-year inputs into a conservative attorney-review checklist.
- The checklist intentionally treats a generic `Closed`/`Complete` service-request status as only a status. It does not convert closure into proof of cleanup or lawful enforcement.

## ATL311 source investigation — 2026-08-29

The question was whether Unignorable can consume ATL311 and whether another project is already doing it. The answer is: **historical and downstream data are available; a current authoritative bulk feed was not found.**

### Sources found

- **Historical full export:** [brian-murphy/atl-311-parser](https://github.com/brian-murphy/atl-311-parser) contains an ATL311 service-request archive from 2015. It includes case number, opened/closed dates, source, department, request type, status, disposition, address fields, council district, and related fields. It is useful for schema discovery, fixtures, and historical analysis—not current monitoring.
- **Current downstream project:** [Pulse ATL](https://github.com/tomiwaaluko/pulseATL) has the most relevant current ingestion and normalization work. Its [source notes](https://github.com/tomiwaaluko/pulseATL/blob/main/backend/src/ingest/SOURCES.md) show that its ATL311 input is still the historical archive above, not a live Atlanta feed. The project also notes that the archive has structured addresses but no numeric coordinates, so geocoding or spatial rejection is required before NPU assignment.
- **Older analysis/scraping:** [bbrewington/atl-see-click-fix](https://github.com/bbrewington/atl-see-click-fix) has 2018–2019 SeeClickFix/ATL311 extracts and an old per-case scraper. Its URL and page assumptions are not a production integration seam.
- **Custom intake, not a data source:** [zsociety47/atl311-intake](https://github.com/zsociety47/atl311-intake) is a custom intake/case-management application; it does not provide Atlanta's official records.
- **Aggregate current view:** the [Atlanta PAD Data Dashboard](https://dashboard.atlantapad.org/) incorporates ATL311 in neighborhood-level reporting, but it does not expose the underlying case-level table needed for evidence timelines.
- **Records-request precedent:** [MuckRock's Atlanta 311 records page](https://www.muckrock.com/agency/atlanta-325/atlanta-311-37592/) contains current-ish request examples and spreadsheet attachments. This confirms that usable exports can be obtained even though they are not published as a stable API.

The present ATL311 site is a Power Platform case-search experience. It supports searching case status, but no documented public bulk API or stable historical endpoint was located. Production code should not depend on undocumented portal internals or scrape private/account-bound views.

### Recommended acquisition path

Ask `OpenRecords-311@atlantaga.gov` for a 24-month CSV/XLSX export and its field definitions. The request should ask for, at minimum: case number, opened/updated/closed timestamps, request type and subcategory, department, status, disposition or resolution text, address/geographic fields, council district/NPU if available, and any source or duplicate indicators. Also ask whether the export can be supplied on a recurring monthly schedule.

Until a current export arrives, the source ladder is:

1. An official current export or permissioned recurring delivery.
2. The 2015 GitHub archive for schema and historical/backfill work.
3. Aggregated dashboards or independent trackers as contextual corroboration only.

When an export arrives, preserve the original file outside Git, record retrieval date/request identifier/checksum, and import through a versioned CSV/XLSX adapter. Normalize status and request type, but preserve the raw disposition text. A 311 record remains chronology/location evidence; it is not proof of a nuisance, non-enforcement pattern, causation, damages, or cleanup.

### ChatGPT Work boundary

ChatGPT Work or a Workspace Agent is a reasonable coordinator for drafting the request, tracking correspondence, parsing returned files, and scheduling follow-ups. It does not create access to ATL311 or turn the Power Platform portal into a public feed. The initial request, fee authorization, and any consequential follow-up should remain human-approved. No request has been sent as part of this repository work.

## Remaining before a live Atlanta map

1. Obtain and verify a current bulk ATL311 export and its field semantics; prefer an official Open Records delivery over undocumented portal scraping.
2. Download and pin the official Atlanta city-limits GeoJSON and current council-district geometry from ATL GIS.
3. Define Atlanta-specific request categories and outcome language with a source audit, including what can be safely shown about homelessness, substance use, and public safety.
4. Add parcel/tax records and an owner-supplied expense/value evidence flow only after privacy, legal, and counsel review.
5. Keep the public product framed as evidence organization and accountability; do not advertise guaranteed compensation or legal advice.
