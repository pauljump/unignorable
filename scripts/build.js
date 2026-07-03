// Build issues.json + trends.json from sidewalk's 311 DB — Node version.
// Why Node (not the sqlite3 CLI): under launchd the CLI is denied TCC access to the
// Desktop-located DB ("authorization denied"); the Node binary has access (the ingest proves it).
// Writes are ATOMIC (temp → rename) so a failed/denied run never leaves an empty file and never
// takes the site down. Used by refresh.sh and runnable by hand: `node scripts/build.js`.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB = process.env.DB || '/Users/mini-home/Desktop/Monorepo/sidewalk/data/sidewalk.db';
const dataDir = path.join(__dirname, '..', 'data');
const TYPES = "('Encampment','Homeless Person Assistance','Drug Activity','Panhandling')";

const db = new DatabaseSync(DB, { readOnly: true });

const issues = db.prepare(`
  WITH base AS (
    SELECT complaint_type AS type,
           round(latitude,3)||','||round(longitude,3) AS id,
           latitude, longitude, created_date, closed_date, resolution_description,
           incident_address, council_district, community_board, borough, agency,
           LEAD(created_date) OVER (
             PARTITION BY complaint_type, round(latitude,3)||','||round(longitude,3)
             ORDER BY created_date) AS next_created
    FROM sr311
    WHERE latitude IS NOT NULL AND complaint_type IN ${TYPES}
  )
  SELECT type, id, count(*) AS n,
         round(avg(latitude),5) AS lat, round(avg(longitude),5) AS lng,
         min(date(created_date)) AS first_seen, max(date(created_date)) AS last_seen,
         max(agency) AS agency,
         sum(CASE WHEN closed_date IS NOT NULL THEN 1 ELSE 0 END) AS closed_n,
         sum(CASE WHEN resolution_description LIKE '%no Encampment was found%'
                   OR resolution_description LIKE '%observed no encampment%'
                   OR resolution_description LIKE '%could not find%'
                   OR resolution_description LIKE '%could not locate%'
                   OR resolution_description LIKE '%did not observe%'
                   OR resolution_description LIKE '%no one was%'
              THEN 1 ELSE 0 END) AS nothing_found,
         sum(CASE WHEN closed_date IS NOT NULL AND next_created IS NOT NULL AND next_created > closed_date
              THEN 1 ELSE 0 END) AS returned_n,
         round(avg(CASE WHEN closed_date IS NOT NULL AND next_created IS NOT NULL AND next_created > closed_date
              THEN julianday(next_created) - julianday(closed_date) END), 1) AS avg_return_days,
         max(incident_address) AS addr, max(council_district) AS council,
         max(community_board) AS board, max(borough) AS borough
  FROM base GROUP BY type, id HAVING n >= 5 ORDER BY n DESC
`).all();

const trends = db.prepare(`
  SELECT strftime('%Y-%m', created_date) AS month, complaint_type AS type, count(*) AS n
  FROM sr311
  WHERE complaint_type IN ${TYPES} AND created_date >= '2021-06-01'
  GROUP BY month, type ORDER BY month ASC
`).all();

// ---- Episode model: split each location's timeline into episodes (instances) ----
// One LOCATION holds 1..N EPISODES (continuous runs of reports) holding 1..N REPORTS.
// Adaptive gap G* = clamp(K * the location's own median inter-report gap, MIN, MAX):
// the spot defines its own "normal," and a silence beyond G* ends an episode / means resolved.
const K = 4, MIN_GAP = 21, MAX_GAP = 90, PERSIST = 120, EMERGE_MAX = 45;
const ord = s => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
const iso = o => new Date(o * 86400000).toISOString().slice(0, 10);
const median = a => { if (!a.length) return MAX_GAP; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

const dayRows = db.prepare(`
  SELECT complaint_type AS type, round(latitude,3)||','||round(longitude,3) AS id,
         date(created_date) AS d, count(*) AS c
  FROM sr311 WHERE latitude IS NOT NULL AND complaint_type IN ${TYPES}
  GROUP BY type, id, d ORDER BY type, id, d
`).all();

let DATA_ORD = 0;
for (const r of dayRows) { const o = ord(r.d); if (o > DATA_ORD) DATA_ORD = o; }

function episodesFor(rows) {
  const days = rows.map(r => ord(r.d)), counts = rows.map(r => r.c);
  const gaps = []; for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);
  const gm = days.length < 2 ? MAX_GAP : median(gaps);
  const G = Math.min(MAX_GAP, Math.max(MIN_GAP, K * gm));
  const eps = []; let s = days[0], last = days[0], rc = counts[0];
  for (let i = 1; i < days.length; i++) {
    if (days[i] - last > G) { eps.push([s, last, rc]); s = days[i]; rc = counts[i]; }
    else rc += counts[i];
    last = days[i];
  }
  eps.push([s, last, rc]);
  const silence = DATA_ORD - days[days.length - 1];
  const active = silence <= G;
  const cur = eps[eps.length - 1], curDur = cur[1] - cur[0];
  let pattern;
  if (active) pattern = curDur >= PERSIST ? 'persistent' : (eps.length === 1 && curDur < EMERGE_MAX ? 'emerging' : 'ongoing');
  else pattern = 'resolved';
  return {
    status: active ? 'active' : 'resolved',
    pattern,
    episode_count: eps.length,
    current_days: curDur,
    silence,
    cadence: G,
    confidence: active ? null : +(silence / G).toFixed(2),
    episodes: eps.map(([a, b, c]) => [iso(a), iso(b), c]),
  };
}

// stream the day-rows, accumulate per location, merge episode summary into the kept issues
const byKey = new Map(issues.map(r => [r.type + '|' + r.id, r]));
let cur = null, buf = [];
const flush = () => { if (cur) { const rec = byKey.get(cur); if (rec) Object.assign(rec, episodesFor(buf)); } buf = []; };
for (const r of dayRows) { const k = r.type + '|' + r.id; if (k !== cur) { flush(); cur = k; } buf.push(r); }
flush();

// ---- NARRATIVE ENGINE: one precomputed "most damning fact" headline + a 0–100 score per issue ----
// Deterministic, pure arithmetic over fields already on the row. Both are SINGLE SOURCE OF TRUTH:
// the card and the shame-board read issue.headline / issue.score, never re-derive them.
const num = v => Number.isFinite(v) ? v : 0;

// Headline: pick the most damning TRUE signal in fixed precedence; cite only literal field values.
// R1 cites the raw nothing_found count (never a %): nothing_found is matched over ALL rows while
// closed_n needs a non-null closed_date, so nothing_found/closed_n can exceed 1.
function pickHeadline(r) {
  const nf = num(r.nothing_found), cn = num(r.closed_n), rn = num(r.returned_n);
  const ard = (r.avg_return_days != null && Number.isFinite(r.avg_return_days)) ? r.avg_return_days : null;
  const cd = num(r.current_days), ec = num(r.episode_count), n = num(r.n);
  // R1 — nothing found (highest priority, the city's own hollow-response text)
  if (nf >= 10 && cn > 0 && (nf / cn) >= 0.30)
    return { kind: 'nothing_found', text: `The city closed ${fmtN(nf)} of these reports saying nothing was found.` };
  // R2 — fast return (revolving door); guard ard>0 excludes nulls/zeros
  if (rn >= 10 && ard != null && ard > 0 && ard <= 14)
    return { kind: 'fast_return', text: `Closed ${fmtN(rn)} times. A new report came in within ${ard.toFixed(1)} days on average.` };
  // R3 — persistence (unbroken run); only emit when the latest episode is still open
  if (cd >= 120 && r.status === 'active')
    return { kind: 'persistence', text: `Unbroken for ${fmtN(cd)} days and still open.` };
  // R4 — recurrence (chronic flare-ups)
  if (ec >= 8)
    return { kind: 'recurrence', text: `Flared up ${fmtN(ec)} separate times at this spot.` };
  // R5 — volume (fallback, always true)
  return { kind: 'volume', text: `${fmtN(n)} reports filed here.` };
}
function fmtN(x) { return Math.round(x).toLocaleString('en-US'); }

// Score: 100-point weighted sum of six clamped [0,1] damning factors. Pure arithmetic.
const LOG5000 = Math.log10(5000);
function scoreFor(r) {
  const nf = num(r.nothing_found), cn = num(r.closed_n), rn = num(r.returned_n);
  const ard = (r.avg_return_days != null && Number.isFinite(r.avg_return_days)) ? r.avg_return_days : 0;
  const cd = num(r.current_days), ec = num(r.episode_count), n = num(r.n);
  const f_nothing = cn === 0 ? 0 : Math.min(1, nf / cn);
  const f_return  = cn === 0 ? 0 : Math.min(1, rn / cn);
  const f_fast    = (rn >= 5 && ard > 0) ? Math.max(0, Math.min(1, (30 - ard) / 30)) : 0;
  const f_persist = Math.min(1, cd / 365);
  const f_recur   = Math.min(1, ec / 12);
  const f_volume  = Math.min(1, Math.log10(Math.max(1, n)) / LOG5000);
  const s = 22 * f_nothing + 24 * f_return + 16 * f_fast + 14 * f_persist + 12 * f_recur + 12 * f_volume;
  return Math.round(s * 10) / 10;
}

for (const r of issues) {
  const h = pickHeadline(r);
  r.headline = h.text;
  r.headline_kind = h.kind;
  r.score = scoreFor(r);
}
// Sanity log: top citywide score + per-borough #1 spread (confirms the formula discriminates).
{
  const sorted = [...issues].sort((a, b) => b.score - a.score);
  const byB = {};
  for (const r of issues) { const b = r.borough || 'Unspecified'; if (!byB[b] || r.score > byB[b]) byB[b] = r.score; }
  console.log('narrative: top score', sorted[0].score, '| per-borough #1:',
    JSON.stringify(byB), '| headline kinds:',
    JSON.stringify(issues.reduce((a, r) => (a[r.headline_kind] = (a[r.headline_kind] || 0) + 1, a), {})));
}

const dist = {};
for (const r of issues) dist[r.pattern] = (dist[r.pattern] || 0) + 1;
console.log('pattern distribution:', JSON.stringify(dist),
  '| active:', issues.filter(r => r.status === 'active').length);

if (issues.length < 100 || trends.length < 10) {
  throw new Error(`refusing to write suspiciously small output: ${issues.length} issues, ${trends.length} trend rows`);
}

function atomicWrite(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);   // atomic on same filesystem
}
atomicWrite(path.join(dataDir, 'issues.json'), issues);
atomicWrite(path.join(dataDir, 'trends.json'), trends);
console.log(`built ${issues.length} issues + ${trends.length} trend rows (atomic)`);

// ---- Win-condition pass for active campaigns ----
// Wrapped in try/catch: if ugc.db/campaigns table is absent, the daily refresh must NOT crash.
// Win = issue resolved (status resolved OR silence > cadence) AND citizen verdict cleared AND
// episode has been silent >= 60 days. This is the only computed status flip for v1.
try {
  const ugc = require('../ugc');
  const campaigns = ugc.allCampaigns();
  const issueByKey = new Map(issues.map(r => [r.type + '|' + r.id, r]));
  let wonCount = 0, checkedCount = 0;
  for (const camp of campaigns) {
    if (camp.status !== 'active') continue;
    checkedCount++;
    const issue = issueByKey.get(camp.issue_key);
    if (!issue) continue;
    // Condition 1: issue resolved (status==='resolved' OR silence > cadence)
    const isResolved = issue.status === 'resolved' || (Number(issue.silence) > Number(issue.cadence));
    if (!isResolved) continue;
    // Condition 2: citizen verdict is 'cleared'
    let verdict = 'unverified';
    try { verdict = ugc.thread(camp.issue_key).verdict; } catch {}
    if (verdict !== 'cleared') continue;
    // Condition 3: durable silence >= 60 days
    if (Number(issue.silence) < 60) continue;
    // All three conditions met: flip to won
    const wonAt = new Date().toISOString();
    ugc.setCampaignStatus(camp.issue_key, 'won', wonAt);
    wonCount++;
    console.log(`campaign won: ${camp.issue_key} (silence=${issue.silence}d, verdict=${verdict})`);
  }
  if (checkedCount > 0 || wonCount > 0)
    console.log(`win-condition pass: checked ${checkedCount} active campaigns, ${wonCount} newly won`);
} catch (e) {
  // Never take the site down — log and continue.
  console.warn('win-condition pass failed (non-fatal):', e.message);
}
