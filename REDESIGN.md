# unignorable — Redesign Handoff (2026-07-13)

> For the next agent (Codex or Claude) picking up this work cold. Read this + `CLAUDE.md` first. Everything below is so you don't have to re-derive it. The canonical plan also lives at `~/.claude/plans/okay-with-unignorable-i-sparkling-pudding.md` (Claude home — may be invisible to you; the essentials are duplicated here).

## 0. Where things run / how to ship
- **Live app is THIS dir** `~/unignorable/` — **out of the monorepo**, a stable dir. `server.js` = zero-dep Node HTTP server on **:8000**, pm2 process `unignorable`. Public: **unignorable.polyfeeds.dev** (Cloudflare tunnel).
- **Build discipline:** stage a copy in `/tmp/unig-*`, verify, then copy back ONLY code files (`server.js`, `ugc.js`, `index.html`, `scripts/*`) → `pm2 restart unignorable` → verify live through the tunnel. **NEVER overwrite `data/`** (`ugc.db`, `issues.json`, `photos/` are runtime/generated; `data/*.json` + `*.db` are gitignored).
- **Regenerate data:** `scripts/refresh.sh` (311 ingest → `node scripts/build.js` → restart). `build.js` MUST use `node:sqlite`, never the `sqlite3` CLI (launchd TCC denies Desktop DB access via the CLI).
- **Static design mocks** are served noindex at `/design/<slug>` from `design-mocks/<slug>.html` (no restart needed to add one).

## 1. What shipped this session (DONE, live — do not redo)
**Area (zone) share** — bundle many map bubbles under one permalink. See `CLAUDE.md` entries "AREA SHARE" (Phase 1 user-minted `/a/<hexid>`) and "PHASE 2" (auto hotspots `/a/<slug>` e.g. `/a/intrepid`, `/hotspots` index). Keep the **"Share this area" button** and the **map overlay** — Paul explicitly likes both.

## 2. THE REDESIGN (approved plan — this is the work to pick up)
**Reframe (one line):** Stop rendering *what was reported*. Render **what's confirmed here now, what it actually is, how long it's gone ignored, and what it's costing the city** — and let people **vote it up.** The platform's act is **solidifying** a vague 4-type 311 estimate into a described, ranked, living instance.

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

## 4. Cost model (Pillar 4) — RESEARCHED, ready to implement in build.js
Conservative floor constants (so we never overstate):
- `C_311 = 3.39` — per 311 contact processed (Pew 15-city avg, via Governing).
- `C_RESP = 50.00` — per NYPD/agency field response. **DERIVED, the only un-cited number** (~1 loaded officer-hour). Options if you want it bulletproof: drop it, or label it "estimated officer time" in the UI.
- `C_CLEANUP = 1000.00` — per DSNY/NYPD encampment sweep. Below the cleanest sourced figure ($3.5M ÷ ~2,300 sweeps ≈ $1,522, Gothamist citing city data, 2024).

Formula (compute per Issue in `build.js`):
```
base_cost      = closed_n * (C_311 + C_RESP)
cleanup_events = (type === 'Encampment') ? min(episode_count, closed_n) : 0
cleanup_cost   = cleanup_events * C_CLEANUP
estimated_cost = base_cost + cleanup_cost
# reporting-only (NOT additive):
wasted    = nothing_found * (C_311 + C_RESP)   # the "paid, found nothing" headline subset
returned_share = returned_n / closed_n         # money bought no durable result
```
**Worked example — 335 2nd Ave** (closed_n 171, nothing_found 44, episode_count 9, Encampment): 171×53.39 + 9×1000 = **$18,130**. (The mocks show ~$18k — it's real.)

**Honesty note (surface a short version in-product):** a conservative order-of-magnitude estimate of public money spent *responding to* these complaints, not an audited cost or a claim about any individual. Every constant is a floor, so the true cost is likely higher. Does NOT include courts/EMS/hospitalization/property costs and does NOT measure human impact. Anchor with the **NYC Comptroller audit (Jun 2023):** of people present at 2,154 encampment cleanups, only **5% accepted shelter**, and **31% of revisited sites had resumed activity** — the city's own proof the spend fixes nothing. (comptroller.nyc.gov audit of DHS encampment cleanups; NYS Comptroller Report 21-2026 for outreach spend.)

## 5. Prior-art patterns (design rationale — Waze / Watch Duty / Citizen)
The winners never render "data" — they render a few discrete things each with a **state, a clock, and a heartbeat.** Ranked transferable patterns: (1) explicit lifecycle **state** as the primary visual; (2) **recency heartbeat** "confirmed N min ago" + visual **decay** of stale items (Citizen's zoom-coupled time window); (3) **"still here? / gone"** confirm loop that resets decay + drives confidence; (4) **confidence** as a first-class visible chip; (5) 📍 **vicinity not false precision** — start fuzzy, let a person on the ground **collapse it to a point** (Waze snap-to-segment; Zenly/Snap blur); (6) 📍 **fuzz isolated points, sharpen with corroboration**; (7) live **color/state semantics** before any text; (8) **pulse/motion + "LIVE" badge + live counts**; (9) **human-verified provenance** badge (auto-311 vs confirmed-by-neighbor); (10) per-instance **update timeline**; (11) **radius-of-relevance / distance-from-you** framing. Anti-pattern (why 311/SeeClickFix feel dead): archival ticket dump, no decay, no confidence, no confirm loop.

## 6. Design mocks (Phase 0) — LIVE, awaiting Paul's pick
Three glanceable **card** directions, all rendering 335 2nd Ave (Paul's block), files in `design-mocks/`:
- **A · Dossier** (narrative-first + "What neighbors see" citizen layer): `/design/card-a-dossier`
- **B · Vote** (giant ▲ rail, upvote is the card): `/design/card-b-vote`
- **C · Meter** (cost/severity as the hero): `/design/card-c-cost`
All three: real ~$18k cost, pulsing "still here · day 296", §16-122 tag, names CM Epstein, includes the ▲ vote.

## 7. Next steps (ordered — pick up HERE)
1. **Get Paul's card pick** (a posture, or pieces of each). Open decision.
2. **Mock the MAP pin treatment** to match: state + vote-weight + recency **decay** (resolved falls off). Serve at `/design/map-*`.
3. **Phase 1 build** (stage in /tmp): near-me+active default; decay resolved off the map; **▲ vote** as first-class (`/api/seen` → visible count + rank/visual weight; `ugc.js` surface the count); **cost + deterministic "what it is" narrative** computed in `build.js` and surfaced in the header; glanceable `openCard` rebuild + `/c` de-word (progressive disclosure); replace the sparkline with the simple chronic line; fix clustering.
4. **Phase 2:** citizen **descriptor capture** in the report form (chips + text) → `posts` descriptor column (+ `ALTER` migration), moderated via the existing gate.
5. **Phase 3 (optional):** location solidify (pin-nudge + geometry column + vicinity→point).

**Files you'll touch:** `scripts/build.js` (cost + narrative), `server.js` (vote endpoint, cost/narrative in card + `/api/thread`, de-word `renderCampaign`, `/design/*`), `index.html` (`draw()` vote/decay visuals + clustering, `openCard` rebuild, report-form descriptor chips, replace `renderSparkline`), `ugc.js` (vote count surfacing, descriptor column + migration).
