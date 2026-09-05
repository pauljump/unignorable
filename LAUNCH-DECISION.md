# Unignorable launch decision · September 5, 2026

Ship an NYC walking companion with evidence and a feedback loop: **Know your walk. Improve your block.** The immediate job is “help me choose a walk around the reported conditions I care about, and explain the tradeoff.” The durable hypothesis is that people who repeatedly walk the same few blocks can make the evidence more useful by checking changes. Neither traction nor software alone establishes that hypothesis.

This supersedes the earlier records-first launch positioning in PRODUCTION-DIRECTION.md. Retain its evidence standards and review gates. The current instruction to converge and ship web and native iOS expands the earlier implementation boundary.

## Evidence and alternatives

Research checked September 5, 2026, against primary product sources:

| Product | Existing job | Implication for this launch |
| --- | --- | --- |
| [Citymapper](https://citymapper.com/news/2407/pick-main-roads-for-your-walk-route) | Walking routes that prioritize main roads and try to avoid parks and river paths | “Better directions” alone is weak differentiation. Explain actual selected-condition crossings and the time/distance tradeoff. |
| [WalkSafe](https://walksafe.io/) | Journey sharing, safe spaces and community reporting; the company also collects venue feedback | Feedback and walking safety are established categories. Avoid an unsupported safety guarantee; do not build another SOS or family-tracking product. |
| [Citizen](https://sky.citizen.com/) | Nearby incident alerts, video and updates | Recurring block conditions and dated records are a different job from breaking incidents. Do not lead with an alarm feed. |
| [FixMyStreet](https://fixmystreet.org/running/admin_manual/) | Public reports, updates, status changes and timelines | A public issue history is not novel. Test whether connecting a practical daily walk to dated checks produces useful repeat engagement. |
| [SeeClickFix](https://www.civicservice.civicplus.help/hc/en-us/articles/14980165150871-Identify-Stalled-Issues-for-Integrations) | Municipal reporting and tools to identify stalled requests | City workflow integrations already exist. Do not claim an exclusive accountability mechanism or launch government procurement. |

These sources establish product capabilities, not comparative performance, market size, search demand or willingness to pay. The user's reported post traction is not yet linked to the exact post, replies, signups or repeat use. Existing local product audit recorded zero condition observations and zero action receipts. Do not translate that into a traffic figure.

The narrow audience is someone who regularly walks the same NYC blocks and wants control over the route. Tourists may try it, but repeat local exposure is the hypothesis worth testing. NYC data already exists and can deliver first-use utility without waiting for a community. The possible advantage is the accumulated, reviewed history of a block and recurring walker trust; it is not a moat today. The product can fail if the public data is too stale, detours are not worth the cost, or walkers do not return.

## Launch contract

Both clients offer the same core:

1. One map with an understandable introduction and an explicit Plan my walk action.
2. Walking only in the launch UI. Optional avoidance choices start off; selecting “Plan around it” on a particular condition is an explicit choice to include it. Keep existing driving API compatibility for historical callers.
3. The same backend-selected routes, alternatives, evidence tradeoffs and external Apple/Google Maps links. External maps can recalculate; the in-app line remains authoritative. Do not advertise full background turn-by-turn navigation.
4. Searchable block records with source history, nearby checks, reviewed lifecycle, retained-history caveats and shared canonical record URLs. Native records and feedback are SwiftUI, not web wrappers. Supplemental layers and Citi Bike remain secondary controls.
5. Visible product feedback and a contextual prompt after generating a route. Collect a topic, a usefulness answer and free text; never silently attach route endpoints or location. Nearby observations remain a separate, proximity-checked, moderated path.
6. A private operator inbox with new/reviewing/planned/shipped/closed status and replies. A random receipt link shows status and reply, with latest receipt remembered on device. No unsolicited email, account signup or paid feedback vendor. Expire feedback after 90 days. Submitted feedback is not an instruction to perform an external action.
7. Free early access on both platforms using the fleet's existing route bypass. No Stripe launch purchase and no StoreKit product in this release. Evaluate pricing after repeat value is demonstrated.
8. Published privacy and support URLs. No claims of verified safety, live presence, certain detection, or guaranteed resolution.

Existing platform differences are deliberate implementation details: web has GPX export and browser-local planner restoration; iOS has native address search, MapKit, share sheets and native location permission. The launch does not add accounts or synchronize private trip information. Full history/action pages remain additional web surfaces; the same core evidence and action record is reachable from iOS.

## Feedback operations and next decisions

Review `/feedback/review` using the existing review session. The observation-review page links to the product inbox. Review each weekday during launch; this is an operating commitment to fulfill, not a claim that an unattended inbox has an SLA. Classify safety-relevant route errors and data freshness problems first, then activation blockers, then requests. A status is not a delivery commitment; write a concrete reply. `DATA_DIR=… npm run report:feedback` reads only aggregate counts without user text.

Run the first two weeks with 20 qualified recurring NYC walkers recruited manually by the founder; do not fabricate participants, observations or feedback. Use a voluntary follow-up conversation/diary to establish completed walks and repeat use; aggregate page and feedback events cannot identify unique users. The target is at least 10 who choose one route, at least 5 who voluntarily use it on three separate days, and at least 5 substantive feedback submissions. Ask what route they would otherwise have used and whether the tradeoff was worth it. These are decision thresholds, not statistical validation.

Among willing nearby participants seek five reviewed checks on at least two days, including absent/uncertain reports. Preserve the previous pilot's independent-review and humane follow-through standards. Product success in the first fortnight is repeated useful walks and actionable feedback; durable civic improvement remains a separately measured long-term outcome. Zero verified durable outcomes is an honest possible result.

If fewer than 5 of 20 return on three days, investigate observed failures before adding social or paid features. If users return for routes but decline checks, keep the useful route product and stop describing an established community evidence flywheel. If they primarily want records and follow-up, promote records for that audience based on behavior. If source freshness undermines route decisions, reduce claims and prioritize data quality before expanding cities.

Build next only from repeated observed needs: remembered walks and changes since last visit; a specific missing route preference; better failure recovery; and a reviewed check request along a walk. Defer push, background tracking, accounts, payments, rewards, new cities, government sales, and broad category expansion. No new paid provider calls were needed to implement the slice.

## Release verification

See RELEASE-20260905.md for exact artifacts, test results, publication status and unresolved distribution steps. The launch decision is a reasoned experiment, not a finding of product-market fit.
