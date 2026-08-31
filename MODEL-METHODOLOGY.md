# Condition model methodology

Unignorable models two questions that must not be collapsed into one:

1. **Site recurrence:** does the public record establish a persistent recurring condition at this address-geocoded site?
2. **Current presence:** how strong is the recent evidence that the condition is present now?

`walk-nowcast-v4-shadow` exposes both. Site recurrence uses duration, active months, distinct report days, and reports following negative checks. The current score uses time-decayed recurrence, report cadence, direct public-agency observations, and imperfect non-detections. Both are inspectable heuristic evidence scores. Neither is a calibrated probability or proof of physical presence.

The product objective is **durable condition resolution**: minimize verified recurring condition burden over time. A closure is only a claim. A condition advances from Clear to Held only after reviewed absence checks on at least two distinct days after that claim and a site-specific quiet window. Old or same-day checks cannot establish durable resolution; a reviewed presence check after the claim or any recurrence reopens the loop. The initial measurable outcomes are current-run days, returns after closure, reviewed clear-check days, quiet-window progress, and time to durable resolution. For encampments, this objective applies to the public-space condition and must be pursued through humane, lawful services and accountable action; people are never the target.

## Why the targets are separate

Dynamic occupancy research shows that failing to model imperfect detection biases estimates of occupancy, colonization, and extinction. A “not observed” response therefore reduces current evidence but does not erase a recurring site. See MacKenzie et al., [*Estimating site occupancy, colonization, and local extinction when a species is detected imperfectly*](https://pubs.usgs.gov/publication/5224260).

NYC’s own service-request location review says requests are associated with a standard address type rather than the exact latitude/longitude selected by a reporter, and may therefore be shared with agencies at an inaccurate location. Unignorable therefore treats a point as a reported-location envelope, not a physical-instance identifier. Coordinate variants within 20 meters consolidate around fixed evidence-weighted anchors. Variants up to a hard 65-meter cluster diameter can consolidate only when a majority of each coordinate group’s source records name the same street and the same two bounding cross streets. This handles reporter address estimates such as 212, 230, and 246 East 20th Street without making proximity alone evidence of identity. See NYC, [*Service Request Location Accuracy*](https://a860-gpp.nyc.gov/downloads/jm214r966?locale=en).

This bounded-anchor consolidation intentionally does not infer that nearby reports describe one physical object. It identifies one canonical condition site for display, routing, evidence, and future checks while retaining source aliases and uncertainty. Unlike connected-component or unconstrained density clustering, the anchor and its segment identity do not move while neighbors are assigned, and every segment-assisted member must remain within 65 meters of every other member. This prevents a chain of reports from joining a whole block. The generated artifact records citywide merge counts and maximum offsets so every refresh remains auditable. Richer candidate methods—including density-based spatial-temporal clustering—must still be evaluated against reviewed site labels. The relevant primary method is Birant and Kut, [*ST-DBSCAN: An algorithm for clustering spatial–temporal data*](https://doi.org/10.1016/j.datak.2006.01.013). We do not claim to run ST-DBSCAN today.

## Join integrity

A forecast’s accountability lifecycle is joined to the nearest same-condition permanent record inside its disclosed uncertainty envelope (65–90 meters for current encampment features). Workflow status never overrides spatial identity. This prevents an exact resolved record from being silently replaced by a different active record on a neighboring block.

## Promotion gate

The current model remains shadow-only and cannot alter route exclusions. Probability language or routing use requires:

- independently reviewed presence and absence checks sampled from predicted-present, predicted-absent, and abstained sites;
- forward-in-time and held-out-site evaluation to avoid temporal and spatial leakage;
- published calibration curves, Brier score, log loss, subgroup error, and abstention coverage against a frozen baseline;
- a versioned model card and reproducible evaluation artifact.

Until that gate is met, the product says “persistent recurring site; current status needs a fresh check” when history is strong but current evidence is weak.
