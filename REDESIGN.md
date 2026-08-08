# unignorable — Redesign Handoff (2026-08-02)

**Status:** Phase 1 shipped to production on 2026-07-13. Dossier posture selected, confirmation promoted, conservative cost model built, map weighting updated, and the app consolidated into the monorepo. On 2026-08-02 Paul picked CityTracker.ai as the closest product posture: a dense, map-first operating system for civic failures, with campaign/action workflow as the differentiator. Visual/on-device QA remains.

> For the next agent (Codex or Claude) picking up this work cold. Read this + `CLAUDE.md` first. Everything below is so you don't have to re-derive it. The canonical plan also lives at `~/.claude/plans/okay-with-unignorable-i-sparkling-pudding.md` (Claude home — may be invisible to you; the essentials are duplicated here).

## 0. Where things run / how to ship
- **Live app is THIS dir** `/Users/mini-home/Desktop/Monorepo/unignorable/`. `server.js` = zero-dep Node HTTP server on **:8000**, pm2 process `unignorable`. Public: **unignorable.polyfeeds.dev** (Cloudflare tunnel).
- **Build discipline:** run `npm run verify`, then `pm2 restart unignorable`, then verify `/healthz` through the tunnel. **NEVER overwrite mutable `data/`** (`ugc.db`, generated payloads, and `photos/`).
- **Regenerate data:** `scripts/refresh.sh` (311 ingest → `node scripts/build.js` → restart). `build.js` MUST use `node:sqlite`, never the `sqlite3` CLI (launchd TCC denies Desktop DB access via the CLI).
- **Static design mocks** are served noindex at `/design/<slug>` from `design-mocks/<slug>.html` (no restart needed to add one).

## 1. What shipped this session (DONE, live — do not redo)
**Area (zone) share** — bundle many map bubbles under one permalink. See `CLAUDE.md` entries "AREA SHARE" (Phase 1 user-minted `/a/<hexid>`) and "PHASE 2" (auto hotspots `/a/<slug>` e.g. `/a/intrepid`, `/hotspots` index). Keep the **"Share this area" button** and the **map overlay** — Paul explicitly likes both.

## 2. THE REDESIGN (approved plan — this is the work to pick up)
**Reframe (one line):** Stop rendering *what was reported*. Render **what's confirmed here now, what it actually is, how long it's gone ignored, and what it's costing the city** — and let people **vote it up.** The platform's act is **solidifying** a vague 4-type 311 estimate into a described, ranked, living instance.

**Product posture added 2026-08-02:** Build the first screen like a professional civic intelligence workspace, not a campaign landing page. CityTracker.ai is the useful reference because it feels like an operating system over public data: full map, address search, filterable/ranked records, property-style dossiers, timelines, saved lists, freshness, and report generation. For Unignorable, the equivalent is:
- **Map + ranked issue list** as the default workspace, with active unresolved civic failures first.
- **Location dossier drawer** for one site: evidence confidence, continuity model, persistence/return inference, school/childcare proximity, cost range, official jurisdiction, timeline, and methodology.
- **Campaign mode inside the dossier**: generate email, X post, link, press tip, CB agenda ask, and permanent receipt trail.
- **Watchlist/alerts** for followed places and user-created campaigns.
- **Citywide intelligence layer**: filters for category, district, school proximity, cost range, confirmation count, continuity confidence, recurrence, and response pattern.

Do not copy CityTracker's real-estate-specific filter overload, account-gated browsing posture, or AI chat as the primary interface. Unignorable's moat is the loop **facts -> impact -> accountable official -> action -> receipt -> outcome**, not just public-data search.

**The "20th & 2nd test"** (Paul's north star): walking past an encampment you should know at a glance — **what it is** (richer than "Encampment") · **how chronic** (reported N× over M months) · **how long** · **what law** it breaks + **how it's ignored** · **what it's cost the city** · with a big **upvote**.

**Pillars (priority order = Paul's emphasis):**
1. **Open = near you, active now.** Default = live around the user; **resolved/closed decays OFF the map** (keep a history toggle). Fix clustering (distinct things shouldn't merge; one thing shouldn't split across the rounding grid).
2. **Say what it actually IS.** Deterministic narrative from data we already have + a **citizen descriptor** captured in the report form (structured chips: tent/structure, trash, scaffolding, blocking-sidewalk + free text). "Solidify *what* it is."
3. **Upvote — over-index.** Corroboration → a prominent **▲ vote**; the dominant action. Votes drive **severity/rank + map visual weight** + a "N neighbors upvoted" heartbeat.
4. **Cost to the city** (see §4 — researched & ready). Headline "$X spent here, still not fixed." Cost = a severity axis.
5. **Chronic + change-over-time, legibly.** Replace the hated sparkline with (a) a dead-simple chronic line and (b) an optional glanceable "how this block changed over time" strip/scrubber (Paul's "weather-like but not literally weather" — MOCK it, don't assume).
6. **Law + how it's being ignored, at a glance** (promote out of the buried record).
7. **Glanceable card (de-word).** Front door = what/chronicity/recency/closed-or-not/cost/law-one-line/upvote; everything else behind progressive disclosure. Mirror on `/c`.
8. **(Optional Phase 3) Solidify the exact location** — on-the-ground confirmer nudges the pin; uncorroborated = vicinity halo, confirmed = crisp point. **Demoted** — not where Paul's energy is.

**Decisions locked:** name stays **unignorable**; **no** formal status taxonomy (one continuous **severity** = votes + chronicity + duration + cost, plus a simple live/closed state; "chronic" is shown, not enumerated); cost always shown as a conservative estimate WITH its basis.

## 3. Audit ground-truth (file:line — don't re-derive)
- An "Issue" = a fixed **~85m (E–W) × 111m (N–S) grid cell**: `scripts/build.js:19,23` round lat/lng to 3 decimals, `GROUP BY type,id`, `HAVING n>=5`. Only 4 types ingested (`build.js:12`): Encampment, Homeless Person Assistance, Drug Activity, Panhandling.
- Map dot = **member centroid** `round(avg(lat/lng),5)` (`build.js:29`). Printed `addr` = `max(incident_address)` — an **arbitrary** member address that can sit anywhere in the cell (`build.js:47`); `council`/`board`/`borough` likewise `max()`. **Precision is fake.** No jitter on the map (`index.html:585`).
- **"Is it live/chronic" brain already EXISTS — reuse it:** episode model `episodesFor()` (`build.js:78-113`) emits `status` (active|resolved), `pattern` (persistent/ongoing/emerging/resolved), `current_days`, `silence`, `cadence`, `confidence`, `episode_count`, `episodes[[start,end,count]]`. Merged at `build.js:108-113`.
- **Cost signal already in the data:** per Issue `closed_n`, `nothing_found`, `returned_n`, `avg_return_days`, `episode_count`, `n`.
- **Corroboration exists but is weak/buried:** "I see this often" → `/api/seen` → `ugc.addPost(...,'seen','still_here')`; verdict logic `ugc.js:165-183`. No prominent count, no ranking by it. Reframe as the ▲ vote.
- **The chart Paul hates** = episode sparkline (`server.js:239-253` `sparkline()`, `index.html` `renderSparkline`). Replace it.
- **The walls:** map card `openCard` = 14 stacked blocks (`index.html:734-798`, only the composer is gated); `/c` receipt `renderCampaign` = 11 blocks (`server.js:490-881`, city record already behind one `<details>`).
- **Citizens CANNOT enrich what/where:** all UGC keyed to `(type,id)` only; `posts` table has **no descriptor and no geometry column** (`ugc.js:22-34`); the report form (`index.html` `submitPost`/`pform`) collects no pin/address/descriptor. Photo capture drops EXIF/GPS.

## 4. Cost model (Pillar 4) — SHIPPED, evidence-limited
The original episode-as-cleanup model was removed because a reporting episode does not prove a cleanup. The production model counts unique `date + response class` units for positive inspections, negative inspections, and outreach. Duplicate requests on the same date/class do not create extra units.

The displayed range uses NYPD's published $58,580 starting salary (`$28.16/hour`) as a transparent labor reference:
```
low      = response_units × $28.16 × 0.5 worker-hours
planning = response_units × $28.16 × 2.0 worker-hours
```
The low case is one worker for 30 minutes; the planning case is two workers for one hour. It is not an audited bill and deliberately excludes 311 intake, vehicles, supervision, contractor overhead, cleanup, shelter, and medical care. Campaign 001's exact-address record currently has 59 units, or about **$831-$3,323**. The wider approximate block has 130 units, or about **$1,831-$7,323**.

## 5. Prior-art patterns (design rationale — Waze / Watch Duty / Citizen)
The winners never render "data" — they render a few discrete things each with a **state, a clock, and a heartbeat.** Ranked transferable patterns: (1) explicit lifecycle **state** as the primary visual; (2) **recency heartbeat** "confirmed N min ago" + visual **decay** of stale items (Citizen's zoom-coupled time window); (3) **"still here? / gone"** confirm loop that resets decay + drives confidence; (4) **confidence** as a first-class visible chip; (5) 📍 **vicinity not false precision** — start fuzzy, let a person on the ground **collapse it to a point** (Waze snap-to-segment; Zenly/Snap blur); (6) 📍 **fuzz isolated points, sharpen with corroboration**; (7) live **color/state semantics** before any text; (8) **pulse/motion + "LIVE" badge + live counts**; (9) **human-verified provenance** badge (auto-311 vs confirmed-by-neighbor); (10) per-instance **update timeline**; (11) **radius-of-relevance / distance-from-you** framing. Anti-pattern (why 311/SeeClickFix feel dead): archival ticket dump, no decay, no confidence, no confirm loop.

## 6. Design mocks (Phase 0) — LIVE, awaiting Paul's pick
Three glanceable **card** directions, all rendering 335 2nd Ave (Paul's block), files in `design-mocks/`:
- **A · Dossier** (narrative-first + "What neighbors see" citizen layer): `/design/card-a-dossier`
- **B · Vote** (giant ▲ rail, upvote is the card): `/design/card-b-vote`
- **C · Meter** (cost/severity as the hero): `/design/card-c-cost`
All three: real ~$18k cost, pulsing "still here · day 296", §16-122 tag, names CM Epstein, includes the ▲ vote.

## 7. Next steps (ordered — pick up HERE)
1. **Mock the CityTracker-style workspace.** Default route should feel like a civic operations console: full map, left/right ranked list, search, tight filters, and a dossier drawer for Campaign 001. Serve as `/design/workspace-citytracker`.
2. **Resolve the card posture inside that workspace.** Use the earlier A/B/C mocks as component studies, but the product direction is now a dossier-driven workspace rather than isolated cards.
3. **Mock the MAP pin treatment** to match: state + vote-weight + recency **decay** (resolved falls off). Serve at `/design/map-*`.
4. **Phase 1 build** (stage in /tmp): near-me+active default; decay resolved off the map; **▲ vote** as first-class (`/api/seen` → visible count + rank/visual weight; `ugc.js` surface the count); **cost + deterministic "what it is" narrative** computed in `build.js` and surfaced in the header; workspace list + dossier `openCard` rebuild + `/c` de-word (progressive disclosure); replace the sparkline with the simple chronic line; fix clustering.
5. **Phase 2:** user-created campaigns + citizen **descriptor capture** in the report form (chips + text) → `posts`/campaign descriptor columns (+ `ALTER` migrations), moderated via the existing gate.
6. **Phase 3 (optional):** location solidify (pin-nudge + geometry column + vicinity→point).

**Files you'll touch:** `scripts/build.js` (cost + narrative), `server.js` (vote endpoint, cost/narrative in card + `/api/thread`, de-word `renderCampaign`, `/design/*`), `index.html` (`draw()` vote/decay visuals + clustering, `openCard` rebuild, report-form descriptor chips, replace `renderSparkline`), `ugc.js` (vote count surfacing, descriptor column + migration).
