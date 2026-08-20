#!/bin/bash
set -euo pipefail
# unignorable daily data refresh — keeps the map/trends current with NYC 311.
# FREE public Socrata data only, no LLM/paid API (compliant with the no-autonomous-paid-calls rule).
# 1) sidewalk's incremental 311 ingest (upsert by unique_key, ~14-day lookback)
# 2) refresh NYC school/childcare facility coordinates
# 3) refresh compact ALPR + recurring 311 map layers and explicit agency-response counts
# 4) rebuild unignorable's legacy issues.json + trends.json
# 5) reload the server so it serves fresh data
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
HERE="$(cd "$(dirname "$0")" && pwd)"
SIDEWALK="${SIDEWALK_DIR:-/Users/mini-home/Desktop/Monorepo/sidewalk}"
DATA_DIR="${DATA_DIR:-$HERE/../data}"
PM2_APP="${PM2_APP:-unignorable-canonical}"
LOG="$DATA_DIR/refresh.log"
ts(){ date "+%Y-%m-%dT%H:%M:%S"; }

{
  echo "[$(ts)] refresh start"
  cd "$SIDEWALK" && pnpm run ingest:one erm2-nwe9 2>&1 | tail -3
  DATA_DIR="$DATA_DIR" node "$HERE/refresh-sensitive-sites.js"
  DATA_DIR="$DATA_DIR" node "$HERE/refresh-map-data.js"
  DB="$SIDEWALK/data/sidewalk.db" DATA_DIR="$DATA_DIR" node "$HERE/build.js"
  pm2 restart "$PM2_APP" >/dev/null 2>&1 && echo "server reloaded"
  NEW=$(node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare('SELECT max(created_date) m FROM sr311').get().m)" "$SIDEWALK/data/sidewalk.db" 2>/dev/null)
  echo "[$(ts)] refresh done — newest 311 record: $NEW"
} >> "$LOG" 2>&1
