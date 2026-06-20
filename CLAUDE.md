# unignorable

## What This Is

Civic accountability map for NYC. Makes the city's own record of **chronic, ignored quality-of-life issues** impossible to look away from. 311 is a private 1:1 routing tool with no memory and no public — so one encampment gets reported thousands of times and closed thousands of times, invisibly. unignorable assembles those scattered tickets into one persistent **Issue** with a city-inaction timeline, and adds an **"I see this often"** corroboration signal.

Thesis proof (real data, 2026-06-18): NYC's #1 outcome for the 199,865 "Encampment" reports is *"The Police Department visited the location and no Encampment was found"* (86,688 of them). The most-reported single spot (Waverly Place) was filed **2,433 times across 2021→2026, still active.**

"Name & Shame": **Name** = anon report/comment/vote/validate (the "I see this often" button). **Shame** = this public board. Future: bounties (clean trash / hose sidewalk).

## How We Build Together

Monorepo collaboration protocol. Main by default; branch + PR only when Paul asks.

## Architecture (v0 skeleton — "feel it" build)

```
~/unignorable/                 # OUT of the monorepo (stable dir, like jumpbank/rexair demos) — bridge worktrees reset
  server.js                    # zero-dep Node http server. GET / , GET /api/issues , POST /api/seen
  index.html                   # single-page Leaflet map (CARTO dark, no key) + Issue card + "I see this often"
  data/
    issues.json               # 12,232 pre-clustered Issues (3.1MB) — the moat output
    seen.json                 # live "I see this often" tallies (persisted on POST)
```

- **Data source:** reuses sidewalk's `data/sidewalk.db` (510K 311 rows, 5-yr backfill) read-only. No re-ingest.
- **The clustering engine (the moat):** groups sr311 points by ~110m grid cell (`round(lat,3),round(lng,3)`) × complaint_type into Issues with: count, centroid, first/last seen, `nothing_found` count (city visited + closed "nothing found"), representative address, council district, community board.
- **Types in v0:** Encampment, Drug Activity, Homeless Person Assistance, Panhandling (the 4 quality-of-life types sidewalk ingested).

### Regenerate issues.json

```bash
DB=/Users/mini-home/Desktop/Monorepo/sidewalk/data/sidewalk.db
# see the SQL in the 2026-06-18 build (groups by type + rounded cell, HAVING n>=5)
```

## Deploy

| Component | Where | Port | URL |
|-----------|-------|------|-----|
| web (zero-dep node) | pm2 `unignorable` (pm2 save'd) | **8000** | unignorable.polyfeeds.dev |

Cloudflare: ingress + DNS CNAME added via API (mini-dev tunnel). `unignorable.app` available — buy when ready.

```bash
pm2 restart unignorable        # after editing server.js / index.html / issues.json
```

## Current State

**Status:** LIVE skeleton (2026-06-18) at https://unignorable.polyfeeds.dev — pm2 `unignorable` :8000, pm2 save'd.

**Shipped 2026-06-18:**
- Clustered Issue map + Issue card + "I see this often" (POST /api/seen)
- Pulse analytics wired + verified (page_view/dwell + custom `see_often`/`issue_open`); property `unignorable`
- **Closed-vs-fixed accountability metric** (the thesis proof) — `scripts/build-issues.sh` computes, per spot: closed_n, returned_n (closures followed by a new report), avg_return_days. Headline = "67% of closures, problem came back" (273,841 of 406,858 fleet-wide). Cards lead with "closed N× → came back M× — X days after they closed it. Closing the ticket isn't fixing the problem." Agency named per Issue.
- **Trends view** (Map/Trends toggle) — absorbs sidewalk's "is it getting worse?" lens. Inline SVG line chart of monthly 311 volume by type (2021–2026), data/trends.json via /api/trends. Headline: "Encampment reports up 23% YoY."
- **sidewalk CONSOLIDATED into unignorable** — sidewalk's web app was already dead (no pm2 proc, no DNS). Repointed sidewalk.polyfeeds.dev tunnel ingress → :8000 + restored its DNS CNAME; server.js 301-redirects any `sidewalk*` host → unignorable. sidewalk now = unignorable's DATA ENGINE only (its `data/sidewalk.db` + ingest pipeline; we read it for issues.json + trends.json).
- **Data freshness pipeline** — `scripts/refresh.sh` = sidewalk incremental 311 ingest (free Socrata, no LLM) → `node scripts/build.js` (rebuild issues.json + trends.json) → `pm2 restart unignorable`, logged to `data/refresh.log`. Scheduled daily 06:30 via launchd `~/Library/LaunchAgents/com.pauljump.unignorable.refresh.plist` (calendar-only, RunAtLoad=false). Header shows a live "current through {date} · refreshed daily" stamp from max last_seen.
  - **⚠️ GOTCHA (fixed 2026-06-19, took the site down once):** the launchd job has NO TCC access to the Desktop-located `sidewalk.db`, so the `/usr/bin/sqlite3` CLI fails with "authorization denied". The Node binary DOES have access (the ingest proves it). So the builder MUST be Node (`build.js`, uses `node:sqlite`), never the sqlite3 CLI. `build.js` also writes ATOMICALLY (temp→rename) + refuses to write suspiciously small output — so a denied/failed run can never leave an empty issues.json and crash the server again. `build-issues.sh`/`build-trends.sh` are now thin wrappers → `build.js`.

- **Temporal / episode model (Location › Episode › Report)** — fixes "listing every issue ever." Each location's report timeline is split into **episodes** (instances) via an **adaptive gap** `G* = clamp(4 × the location's own median inter-report gap, 21d, 90d)` — the spot defines its own "normal," silence beyond G* ends an episode / means resolved (sessionization; survival-analysis is the principled generalization). Two axes: **status** = active (silence ≤ G*) vs likely-resolved (silence > G*, confidence = silence/G*); **pattern** = persistent (current run ≥120d) / ongoing / emerging / resolved; **recurrence** = episode_count badge. Real distribution: 360 persistent, 3,721 ongoing, 22 emerging, **8,334 resolved (67% — the dilution Paul flagged)**, 4,103 active. Computed in `build.js` (daily, so status stays live). **Map defaults to active+chronic** (~4,100, persistent emphasized/bigger); resolved behind a "show resolved (history)" toggle (faded). Card shows: status banner, an **episode sparkline** (lazy via `/api/episodes`), and a **prediction claim** ("Model: likely resolved — silent 90d vs its 21d cadence; neighbors, is it gone?"). Params K/MIN/MAX/PERSIST tunable at top of build.js.
- **Commentary thread layer (UGC × 311, both first-class)** — every Issue card is now a public thread, not a stat. **City 311 data = the BAIT** ("🏛 The city's story: reported N×, marked 'resolved' M×, came back…"), **citizen commentary = the TRUTH** below it. Model: the Issue is a neutral spine; we seed from 311 now but it's ready for citizen-born issues later. **Citizen verdict defines "fixed"** (still_here / worse / cleaned / gone), overriding the city's "closed". Verdict shows the contradiction: "🚩 STILL HERE — the city calls this 'resolved.' the block says otherwise." UGC store = `ugc.js` + `data/ugc.db` via **built-in `node:sqlite`** (zero npm deps, no flag needed on node 22.22). Endpoints: GET `/api/thread`, POST `/api/post` (text + optional status), POST `/api/seen` (one-tap corroborate). All anonymous, no account.

## Refresh / keep data fresh
```bash
bash ~/unignorable/scripts/refresh.sh      # manual full refresh (ingest + rebuild + reload)
tail -f ~/unignorable/data/refresh.log     # watch the daily job
launchctl list | grep unignorable          # confirm the schedule is loaded
```

**Durability follow-ups (NOT yet done — needed for a proper "land"):**
- Add to repo `ecosystem.config.js` (zero-dep node entry) so it's in the canonical boot list
- Add port 8000 row to `brain/playbooks/local-dev-deploy.md` registry
- Register in dash (`dash/src/lib/config.ts` SUBDOMAINS) so it shows on dash.polyfeeds.dev
- Mark `sidewalk/CLAUDE.md` consolidated (it still says "Status: live")

**NEXT SESSION — pick up here (open threads, in priority order):**
1. **Paul's QA on the episode model** — does the active/resolved cutoff feel right? Does the prediction read as credible? Tune `K / MIN_GAP / MAX_GAP / PERSIST` at the top of `scripts/build.js` if not. (Awaiting his read after kicking tires.)
2. **Report-capture / submission flow = THE REAL MOAT (deliberately deferred).** 311 open data has NO photos / no free-text (descriptor is "N/A"; 252K mobile reports' photos are withheld). So the rich layer (photo + description at the spot) is what WE create as the third party. The Issue is already modeled as a neutral spine ready for citizen-born issues. This is the big next build.
3. **Comment moderation / rate-limit** — the thread layer is fully open + anonymous with NO spam/abuse guard. Needs one before public.
4. The repo housekeeping batch above (ecosystem/registry/dash/sidewalk-CLAUDE) — all live stuff works without it; it's about boot-canonical + visibility.
5. Maybe-later: share card per Issue (populus OG-card pattern → travels to X/press/council); fold in muster as the voice report path; bounties marketplace (the old `snitch` idea).

**Backup:** this dir is git-backed at the `unignorable` GitHub repo (pushed 2026-06-19). Re-push after changes: `cd ~/unignorable && git add -A && git commit -m '…' && git push`.
```
