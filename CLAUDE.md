# Unignorable

## What This Is
<!-- 🔒 ASK PAUL — this is the product vision, not a technical summary -->

**TBD — needs Paul's input.** (Observable: a Next.js 16 + React 19 + Tailwind 4 web app with better-sqlite3, Radix Slot, lucide-react. `Dockerfile` present. No README. Workspace member at `unignorable`.)

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

**Status:** paused
**Last updated:** 2026-05-08
**What just shipped:** —
**What's next:** Confirm direction with Paul; archive or revive.
**What's blocking:** —

## Success Metrics
<!-- 🔒 ASK PAUL — he defines what winning looks like -->

**TBD — needs Paul's input.**
