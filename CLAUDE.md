# Unignorable

> ⚠️ **THIS DIRECTORY IS NOT THE LIVE APP.** This is the abandoned v1 *council-email* skeleton
> ("Your Council Member Can't Ignore Your Email" — geocode → council district → stalled DOB housing
> projects → draft email). Never deployed; superseded.
>
> **The live, mature product is OUT-OF-REPO at `~/unignorable/` — read `~/unignorable/CLAUDE.md` first.**
> That's the 311-accountability app ("the city's own record of what it keeps ignoring"): reopen-rate
> issue-clustering, "I see this often" / "STILL HERE" citizen verdicts, UGC threads, episode/temporal
> model, daily Socrata refresh. Live at unignorable.polyfeeds.dev, pm2 `unignorable` (server.js on :8000).
> Don't build the vision here — it already exists there.

## What This Is
<!-- 🔒 ASK PAUL — this is the product vision, not a technical summary -->

This in-repo directory = the **dead v1 council-email tool** (Next.js 16 + React 19 + Tailwind 4,
better-sqlite3, Dockerfile). The *product* called "unignorable" lives at `~/unignorable/` (see banner above).
Reusable parts here if ever needed: geocoding, NYC council-district lookup, all 51 council member contacts,
email templates, a Socrata client — candidates to become an "escalation" action on a live Issue someday.

## How We Build Together

This project follows the monorepo collaboration protocol. See root `CLAUDE.md` for the full version. The short version:

1. Scout first, code never — investigate and present before building
2. Surface every decision — no stealth choices
3. Tight loops — check in after meaningful progress
4. Paul's "this feels wrong" is your most valuable signal
5. **Git: main by default; branch + PR only when Paul asks** — commit to main and move on. When Paul asks for a branch/PR (or invokes a skill that requires one), narrate each step in one or two sentences (Paul is learning).
6. **Session handoff** — when Paul ends a session, update `## Current State` below with what shipped, what's next, and what's blocking. See `brain/playbooks/session-handoff.md`.

## Architecture
<!-- 🔓 AUTO-UPDATE as code changes -->

Single Next.js 16 surface (top-level, no `web/` subdir). Standard layout: `src/app/`, `src/components/`, `src/lib/`, `src/data/`. SQLite via better-sqlite3. Dockerfile suggests Cloud Run was the intended target.

### Key Files
<!-- 🔓 AUTO-UPDATE -->

| File | Purpose |
|------|---------|
| `src/app/` | Next.js app router |
| `src/components/` | UI |
| `src/lib/` | Helpers |
| `src/data/` | Data scripts/seed |
| `data/` | SQLite (gitignored or local) |
| `Dockerfile` | Container build |

### Stack
<!-- 🔓 AUTO-UPDATE -->

Next.js 16, React 19, Tailwind 4 (+ tailwindcss-animate), Radix Slot, lucide-react, class-variance-authority, better-sqlite3.

## Build & Run
<!-- 🔓 AUTO-UPDATE -->

```bash
pnpm dev
pnpm build && pnpm start
```

Not in `ecosystem.config.js`.

## What Runs Where
<!-- 🔓 AUTO-UPDATE -->

| Component | Environment | URL/Location | Port |
|-----------|-------------|--------------|------|
| unignorable | not deployed | — | — |

## External Dependencies
<!-- 🔓 AUTO-UPDATE -->

TBD.

## Design Principles
<!-- 🔒 ASK PAUL — these are product decisions -->

**TBD — needs Paul's input.**

## What NOT to Build
<!-- 🔒 ASK PAUL — only Paul adds to this list -->

**TBD — needs Paul's input.**

## Critical Gotchas
<!-- 🔓 AUTO-UPDATE — add here when you hit something painful -->

—

## Naming Conventions
<!-- 🔓 AUTO-UPDATE as patterns emerge -->

TBD.

## Current State
<!-- 🔓 AUTO-UPDATE every session -->

**Status:** superseded / archive candidate (this in-repo dir only — the live product is `~/unignorable/`)
**Last updated:** 2026-06-20
**What just shipped:** — (no code; corrected the record. Prior "paused/not deployed" notes were wrong:
the live unignorable was never this Next.js app, it's the out-of-repo 311-accountability app.)
**What's next:** Decide whether to delete/archive this dead v1 skeleton, or harvest its council-email
parts into the live app as an Issue "escalation" action. All real work happens in `~/unignorable/`.
**What's blocking:** —

## Success Metrics
<!-- 🔒 ASK PAUL — he defines what winning looks like -->

**TBD — needs Paul's input.**
