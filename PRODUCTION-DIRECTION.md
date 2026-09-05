# Product decision — 2026-09-05

Decision recorded before implementation. This is a two-week experiment, not a validated positioning claim or permission to publish. Implementation is isolated in Git worktree `/Users/mini-home/projects/.worktrees/unignorable-records-20260905`, branch `product/block-records-20260905`; the canonical checkout remains unchanged because its daily refresh restarts production from disk.

## A. Decision memo

**Positioning:** Unignorable is the public record for a recurring condition on your NYC block: see what the evidence supports, check what changed, and follow the response through to a reviewed outcome.

**Primary audience:** a resident who repeatedly walks the same block and the block-group organizer who can coordinate two or three neighbors. They have recurring exposure, a concrete question, and a reason to follow up. Nearby workers are a useful adjacent audience. Journalists and community boards distribute and use evidence; they are not the initial daily user. These are hypotheses, not findings from interviews.

**Top three entry pages:** (1) the specific block's `/f?id=…` record from a neighbor or an address/condition search; (2) `/records`, a small NYC pilot directory answering “is there a record for this block?”; (3) `/c?t=…&id=…`, the linked response history and human-controlled action preparation. The existing map, map search, and walking route remain supporting entry channels. No new city or condition category.

**Aha:** “There is a recurring reporting history here, but a city closure doesn't tell me whether it changed. I can see the dates, source grouping, and what has actually been reviewed.”

**Next useful action:** submit present / absent / can't tell from nearby, without leaving the record. A pending check waits for review; it is not verification. With reviewed presence, inspect the response history and prepare one accountable action. With a clear claim, check whether it held. Never infer that opening an email composer sent an email.

**Share:** coordinate a useful check or follow-up on a shared block, using a stable link and a factual preview. Sharing is voluntary; copy completion is not a downstream outcome.

**Return:** bookmark the same record to see reviewed-check counts, later source evidence, and progress against the quiet window; the organizer asks for a later check in their existing group. No accounts, push notifications, or automated outreach in this slice.

**30-day success:** the concrete funnel below, a supported official response or documented escalation on the pilot block, and repeat reviewed outcome checks where a clear claim exists. Zero durable outcomes is an acceptable measured result; it is not evidence of success. A 60–120-day recurrence window cannot honestly be declared complete at day 30.

**Falsification:** after 20 personally qualified nearby viewers, fewer than five checks despite a working proximity flow; fewer than three sender-confirmed actions after reviewed presence; shares with no recipient checks; reviewers cannot reliably distinguish present / absent / uncertain; or the office cannot use the record after a coordinator follows up. If people consistently want only a quick address lookup and refuse follow-up, promote the information wedge. If walkers return but do not contribute evidence, routes are useful but the proposed improvement loop remains unproven. Diagnose permission failures separately from lack of motivation.

## Audit and competing positions

Read: AGENTS, README, PROJECT-CONTEXT, PRODUCT-LOOP, MODEL-METHODOLOGY, package metadata, server routes, map client, UGC schema, fixture tests, deployment policy and fleet entry. Live browser audit: `/`, `/f?id=311-encampment-40.7284--73.9878`, and its linked `/c` on September 5. Public HTTP and local runtime artifact inspection are read-only; no observation or action was submitted.

Observed:

- The root is an almost empty map with icon-only forecast, walk, and layer controls. Its title promises “know what is likely here, and when”; it offers little explanation to a first-time visitor.
- `/f` is server-rendered but universally noindex. It leads with a likelihood estimate and a generic share image, and sends a prospective checker back into the map. Its canonical URL contains redundant coordinates. `/c` is a separate, long campaign/response surface. The sitemap indexes legacy `/c` pages based on an active score and verified official roster, not the forecast record.
- One live `/f` says 582 source reports but shows 718 in its facts. The source feature and nearest compatible legacy Issue have different aggregation boundaries; the presentation obscures this. A nearest join is not an exact identity guarantee.
- Campaign copy includes volume ranks, cost estimates, many action choices and unimplemented bounty/filing slots. These may attract attention without advancing resolution. Do not promote them in the new entry experience; retain existing deep links. Review legacy action wording and contacts manually before using the canary with officials.
- Runtime map artifact generated September 5 contains 1,520 canonical encampment envelopes. Runtime `ugc.db` contains **0 condition observations, 0 action receipts, 1 campaign, 2 posts**. Those counts are not an acquisition baseline and do not establish how many real people visited. The reported strong traffic is user-provided; channel mix, bots and unique human visits remain unknown. Main-map HTML deliberately excludes Pulse; legacy analytics cannot establish this new funnel.
- Proximity submission, deduplication, moderation, sender-confirmed receipts and a five-stage lifecycle already exist. No independently reviewed field labels exist in this store. The lifecycle currently lets unreviewed checks advance Checked; Held lacks an explicit reviewed prior-presence requirement and a check at/after the quiet-window endpoint. Correct these before giving the record a stronger outcome promise.
- The canonical process runs the repository on port 8000. Some HTML is read per request. Keep this slice in startup-loaded server/modules and new assets so implementing locally does not edit an already-served map asset. No PM2 restart, deployment or credentials needed for this task's local implementation.

| Position | High-intent job | Traffic potential (hypothesis) | Improvement link | Decision |
| --- | --- | --- | --- | --- |
| Public condition record and accountability | “Did this recurring problem change; what can we do together?” | Narrow address intent; useful group and reporting links; repeat visits | Strongest if a coordinator reviews checks and follows up | Primary, provisional |
| Searchable 311 / neighborhood intelligence | “What's been reported near this address?” | Broadest plausible search reach; competes with the city's own data and many aggregators | Weak without a next action; report bias can look like neighborhood risk | Acquisition layer; avoid safety rankings and bulk SEO |
| Walking / route avoidance | “How do I get there around selected conditions?” | Frequent utility, but strong incumbents and upstream route costs | May recruit a check; avoidance itself need not improve a condition | Keep secondary; no route paywall or model expansion now |

The differentiator is understandable evidence plus follow-through, not exclusive access to 311. A public record is useful only if it is accurate enough to coordinate action and somebody maintains it. “Maximum sustainable traffic” means grow distribution only as reviewed-check capacity and useful recipient transitions grow. Google recommends original, helpful content with descriptive, non-exaggerated headings; that supports a small substantive pilot over mass generated neighborhood pages ([Search Central](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)). This is not a ranking or search-volume forecast.

## B. Traffic and resolution funnel

Targets are experiment thresholds, not estimates of current performance. Start with one block; use two nearby reference records to test comprehension, not to claim a citywide network.

| Family | 30-day target and denominator | Measurement / authority |
| --- | --- | --- |
| Traffic | 100 record browser-tab visits across pilot; at least 20 locally qualified viewers recruited manually | First-party aggregate `record_view` is a browser-tab proxy, not unique people; coordinator logs qualified participants separately. Record organic/group/journalist source in participant interviews; use existing host analytics only for bot-filtered acquisition diagnostics |
| Traffic | 2 relevant community-group links; 1 journalist/community-board evidence review | Coordinator records actual placements and feedback; no automated posting. No promise of search ranking within 30 days |
| Activation | 40/100 visits spend 10 visible seconds on the record; 10 copy completions; 5/20 qualified nearby viewers submit a check | `record_engaged`, `record_copy`, `check_start` are client diagnostics; accepted observations in SQLite are the submission authority. Deduplicate browser-tab events locally; these ratios are directional, not user-level attribution |
| Activation | 20 return-tab visits per 100 visits, with at least 5 repeat participants in the manual cohort | `record_return` means this browser has seen this record on an earlier UTC day (30-day local retention). Shared devices, cleared storage, private browsing and bots limit interpretation |
| Evidence quality | At least 5 deduplicated checks, at least 2 distinct check days; deliberately request absent/uncertain opportunities; 100% reviewed within 24h | Observation states, pending/approved/rejected split and coordinator review log. Acceptance rate is diagnostic, not a target to inflate. “Can't tell” is useful abstention, not a negative label |
| Evidence quality | Independent second person rechecks at least 3 observations; record agreement and reasons for disagreement | Manual roster held privately by coordinator; IP hashes do not establish independent people. No model promotion with this sample |
| Activation → action | 3 sender-confirmed actions after reviewed presence on the pilot | `action_receipts.sender_confirmed_at`, manually associated with the pilot legacy Issue; prepared receipt count and link requests reported separately. Opening/copying is not sending; request fetches are not official responses |
| Resolution | 1 independently documented official response OR completed escalation within 14 days | Coordinator verifies provenance and date, redacts personal data, records the reference in an operator log. Official responses are not currently a structured product field |
| Resolution | If clear is claimed, reviewed checks at day 7 and day 30, then day 60 or the longer required window; 0 unsupported Held claims | Reviewed prior presence, absence on distinct later days, a check at/after the quiet window, and no later presence. Silence or closed tickets alone never qualify |
| Resolution | Report verified resolved condition-days / fixed enrolled active blocks, plus recurrence and missing-follow-up rates | Manual cohort ledger is authoritative until outcome history exists. Accrue from verified Held through a later supported recurrence, bounded by observation coverage; missing follow-up is unknown, not an extra resolved day. Report raw numerator and denominator; do not sum the current lifecycle snapshot as historical outcome-days |

**Traffic engine:** specific record → factual title/description → group/journalist links → exact-block search → repeat record visits. `/records` provides crawlable pilot links. Only the named pilot records meeting substantive recurrence and source criteria gain indexing; search result variants and all other forecasts stay noindex. Existing legacy sitemap rules remain. No bulk neighborhood or “worst block” expansion. Metadata and in-page evidence use the same grouping. Use text summary previews for the record until a factual per-record image is justified; don't attach the existing accusation-style generic image to every block.

**Outcome engine:** nearby check → review within 24h → one coordinator prepares a service-first request → human sends and confirms the receipt → coordinator verifies a response → reviewed absence and later recheck → Held only when its proof gate passes. Pending review is an explicit bottleneck. Do not recruit beyond available review capacity. The absence of an official-response field and durable outcome event history is a manual operation, not a reason to claim that this software already measures impact end to end.

## C. Ranked backlog (nine changes)

| Rank | Disposition | Change |
| --- | --- | --- |
| 1 | Must ship now | Reuse `/f` as a readable block record with dated current evidence, source grouping, reviewed checks, separate legacy history, and an inline nearby check |
| 2 | Must ship now | Canonical ID-only links and strict alias redirects; pilot `/records` directory, restrained metadata and sitemap additions; visible map link to records |
| 3 | Must ship now | Aggregate first-party funnel diagnostics and a read-only CLI report; avoid new visitor identifiers or geolocation in analytics |
| 4 | Must ship now | Stop pending checks from implying Checked; require reviewed prior presence and an endpoint absence check for Held; show proof limits |
| 5 | Validate manually first | Recruit one coordinator and 20 qualified viewers; verify canonical envelope vs legacy issue mapping, contact ownership and humane action copy before outreach |
| 6 | Validate manually first | Run review/response/outcome log and 7/30/60-day rechecks; establish independent observers and review capacity |
| 7 | Validate manually first | Test block link comprehension and group/journalist usefulness against simple 311 lookup and walking entry; inspect acquisition sources and query intent |
| 8 | Explicitly defer | Bulk neighborhood SEO, dynamic share images, automatic subscriptions, historical condition registry, structured official-response ingestion and a full outcome analytics dashboard; earn each with pilot evidence |
| 9 | Explicitly defer | Accounts, paid promotion, native changes, paywall changes, new cities/categories, elaborate ML, automated sending/filing and incentives; remove legacy bounty/volume-rank promotion in a later audited action-page pass |

## D. Exact two-week implementation slice

1. Add a small pure record presentation module and a three-ID pilot config (near 246 East 20 Street, 240 East 19 Street, and 126 Second Avenue). Selection is for existing NYC coverage and repeat reports, not a field verification or worst-place ranking. Resolve aliases and fail closed for missing records. The pilot directory lists only those records and offers existing map search for other blocks.
2. Replace the `/f` renderer. Render address, source date/freshness, heuristic label with caveat, source report days, pending/reviewed evidence and durable-proof facts. Clearly separate the nearby legacy Issue's counts and link. Main CTA chooses check/review/action from the current evidence; walking stays an ordinary map utility link. Add a user-triggered inline geolocation check, same existing submission/review API, visible error/duplicate states, copy-link feedback, and no auto-location.
3. Use ID-only canonical URLs, redirect known aliases and redundant parameters, and never replace an explicitly unknown ID with a nearby block. Preserve coordinate-only historical lookups as redirects where existing behavior can resolve them. Pilot pages gain `index,follow` only with address, at least five distinct source report days, 30-day span, and the known NYC source. Missing/omitted forecasts remain honest 404s: a permanent all-history condition registry is deferred and the legacy history remains separately addressable. Do not call these guaranteed permanent forecast URLs.
4. Expose `/records` from the map dock through the server's startup-loaded response transformation (no changes to the live-read `index.html`). Add eligible pilot URLs to the sitemap. Keep root map behavior, route engine, API compatibility and current indexability of legacy pages.
5. Add daily `(condition ID, event, count)` totals in the existing local SQLite store. Allowlisted same-origin events only; no raw search queries, referrers, precise location, names or new server-side visitor IDs. In-memory event abuse limiting must not exhaust the observation-write budget. Client local/session storage is optional and bounded; no analytics dependency may block checking. Counts are proxies. CLI reads only aggregates and existing observation/receipt fields, with a 30-day window and explicit limitations. Official responses and historical resolution-days remain manual.
6. Tighten the two lifecycle proof gates without changing model output or routing. Add focused tests for pending review, clear claims without prior presence, same-day absence, endpoint checks, recurrence, canonical redirects, SEO gates, grouping/escaping, event rejection, and the existing observation path.
7. Run syntax/client checks, focused record unit tests and relevant HTTP smoke tests on isolated data. Browser-check record and directory at desktop/mobile sizes with fixture services. No production writes, service calls with paid quota, contacts, push, or restart. Any later release follows the existing fleet/vault runner and canonical hostname policy.

Days 1–3: implement and verify this slice. Days 4–7: coordinator-led comprehension and first checks. Days 8–14: reviewed action and response follow-up; decide whether distribution can expand. The latter activities require real users, not synthetic engagement generated by the agent.

## Implementation and verification record

Implemented on the isolated branch, not deployed. The final record also checks its own source-report timestamp when reopening a clear claim; a quieter legacy grouping cannot hide a newer source report.

- `npm run check` passed, including map client, server and all new JavaScript syntax checks.
- `DATA_DIR=/Users/mini-home/.local/share/unignorable node --test tests/condition-record.test.js tests/smoke.test.js`: 16 focused tests passed. The smoke harness copies data to temporary storage and uses fixture geocode/routing services; it does not mutate the production database. After the source-recurrence guard changed, server syntax and the 12 HTTP smoke tests passed again.
- Tests cover indexing eligibility, missing/unknown records, canonical aliases, separate source totals, escaped content, stale evidence, permission-denial recovery, absent/uncertain check controls, aggregate event allowlisting, pending review, deduplication, existing route behavior and conservative Held proof. Replaced one stale hard-coded closure total with the corresponding value from the copied test snapshot.
- Browser audit of the local preview at desktop and 390×844: directory links, upper-page check CTA, source disclosures, mobile observation choices, copy success and map/walking access verified. No record-page console warnings/errors. No real location permission or real-world observation was submitted. Simulated observation submission is confined to test data.
- All three pilot URLs verified in the local sitemap with matching canonical tags and indexability. The preview CLI reported actual browser view/copy events, zero observations, and unknown historical resolution-days. The same read-only CLI on production reported no checks or receipts, without creating the aggregate table there.
- Portfolio inventory scan completed: no canonical project/idea additions or changes, as expected for an isolated, unreleased worktree.

Files: `PRODUCTION-DIRECTION.md`, `README.md`, `PROJECT-CONTEXT.md`, `PRODUCT-LOOP.md`, `MODEL-METHODOLOGY.md`, `server.js`, `ugc.js`, `condition-record.js`, `record-client.js`, `config/record-pilot.json`, `scripts/record-funnel.js`, `package.json`, `tests/condition-record.test.js`, `tests/smoke.test.js`.

Remaining risks: no user validation; no verified acquisition/channel baseline; no independently reviewed label set; IP-based observation deduplication can merge neighbors on shared Wi-Fi and does not establish identity; record/legacy joins require manual inspection; forecasts can disappear from the runtime artifact; legacy campaign copy and contacts need review before outreach; responses, review latency and historical outcome-days are still manual. Aggregate events can be spoofed and cannot establish per-person attribution. A service restart or refresh can load canonical disk changes, which is why this branch is isolated.

Next real-user experiment: have one coordinator recruit 20 people who regularly pass the East 20 Street pilot block. Give them the record without explanation; ask what is known, what is uncertain, and what they would do next. Seek five proximity checks across multiple days, including deliberate absence/uncertainty sampling; review within 24 hours; then seek three sender-confirmed service-first actions and one documented response or escalation by day 14. Arrange subsequent checks at 7/30/60 days or the longer required quiet window. Compare observed comprehension with a simple 311 lookup and a walking-first entry before expanding distribution.
