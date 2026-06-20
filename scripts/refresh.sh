#!/bin/bash
# unignorable daily data refresh — keeps the map/trends current with NYC 311.
# FREE public Socrata data only, no LLM/paid API (compliant with the no-autonomous-paid-calls rule).
# 1) sidewalk's incremental 311 ingest (upsert by unique_key, ~14-day lookback)
# 2) rebuild unignorable's issues.json + trends.json
# 3) reload the server so it serves fresh data
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
HERE="$(cd "$(dirname "$0")" && pwd)"
SIDEWALK="/Users/mini-home/Desktop/Monorepo/sidewalk"
LOG="$HERE/../data/refresh.log"
ts(){ date "+%Y-%m-%dT%H:%M:%S"; }

{
  echo "[$(ts)] refresh start"
  cd "$SIDEWALK" && pnpm run ingest:one erm2-nwe9 2>&1 | tail -3
  node "$HERE/build.js"                       # Node builder: TCC-safe + atomic writes
  pm2 restart unignorable >/dev/null 2>&1 && echo "server reloaded"
  NEW=$(node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare('SELECT max(created_date) m FROM sr311').get().m)" "$SIDEWALK/data/sidewalk.db" 2>/dev/null)
  echo "[$(ts)] refresh done — newest 311 record: $NEW"
} >> "$LOG" 2>&1
