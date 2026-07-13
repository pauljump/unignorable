// Build issues.json + trends.json from sidewalk's 311 DB — Node version.
// Why Node (not the sqlite3 CLI): under launchd the CLI is denied TCC access to the
// Desktop-located DB ("authorization denied"); the Node binary has access (the ingest proves it).
// Writes are ATOMIC (temp → rename) so a failed/denied run never leaves an empty file and never
// takes the site down. Used by refresh.sh and runnable by hand: `node scripts/build.js`.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB = process.env.DB || '/Users/mini-home/Desktop/Monorepo/sidewalk/data/sidewalk.db';
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
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
         sum(CASE WHEN closed_date IS NOT NULL AND created_date IS NOT NULL
              AND julianday(closed_date) < julianday(created_date)
              THEN 1 ELSE 0 END) AS impossible_closures,
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
const COST = Object.freeze({ contact: 3.39, response: 50, encampmentCleanup: 1000 });

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

// Phantom-closure score (0–100): how much this Issue's closure record looks like paper, not fixing.
// Blends three attributed signals — impossible closures (closed before the report existed),
// nothing-found rate, and revolving-door speed. Deterministic; cites only literal counts.
function phantomScore(r) {
  const cn = num(r.closed_n), nf = num(r.nothing_found), rn = num(r.returned_n), imp = num(r.impossible_closures);
  const ard = (r.avg_return_days != null && Number.isFinite(r.avg_return_days)) ? r.avg_return_days : 0;
  // Any impossible closure is damning on its own; more of them (relative to closures) pushes toward 1.
  const f_imp = imp > 0 ? Math.min(1, 0.6 + 0.4 * Math.min(1, (imp / Math.max(1, cn)) * 3)) : 0;
  const f_nf  = cn === 0 ? 0 : Math.min(1, nf / cn);
  const f_fast = (rn >= 5 && ard > 0) ? Math.max(0, Math.min(1, (21 - ard) / 21)) : 0;
  return Math.round(100 * (0.40 * f_imp + 0.35 * f_nf + 0.25 * f_fast));
}

for (const r of issues) {
  const h = pickHeadline(r);
  r.headline = h.text;
  r.headline_kind = h.kind;
  r.score = scoreFor(r);
  r.nothing_found_rate = num(r.closed_n) ? +(num(r.nothing_found) / num(r.closed_n)).toFixed(2) : 0;
  r.phantom_closure_score = phantomScore(r);
  const cleanupEvents = r.type === 'Encampment' ? Math.min(num(r.episode_count), num(r.closed_n)) : 0;
  r.estimated_cost = Math.round(
    num(r.closed_n) * (COST.contact + COST.response) + cleanupEvents * COST.encampmentCleanup
  );
  r.estimated_cost_basis = {
    closed_responses: num(r.closed_n),
    cleanup_events: cleanupEvents,
    contact_cost: COST.contact,
    response_cost: COST.response,
    cleanup_cost: COST.encampmentCleanup,
  };
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

// ---- DISPARITY ENGINE: how fast the city closes complaints, by council district ----
// The accusation, built entirely from the city's OWN close timestamps + district field:
// "the city closes your district's complaints N× slower than the fastest district."
// No LLM, no characterization of intent — a defensible aggregate fact. Output → disparity.json.
const round1 = v => v == null ? null : Math.round(v * 10) / 10;
const DATA_MAX_DATE = iso(DATA_ORD);
const MIN_DISTRICT_N = 150;   // ignore thin districts; a median off 12 closures isn't a claim
const plainMedian = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const NF_LIKE = "resolution_description LIKE '%no Encampment was found%' OR resolution_description LIKE '%observed no encampment%' OR resolution_description LIKE '%could not find%' OR resolution_description LIKE '%could not locate%' OR resolution_description LIKE '%did not observe%' OR resolution_description LIKE '%no one was%'";
const closeRows = db.prepare(`
  SELECT CAST(council_district AS TEXT) AS cd, borough, complaint_type AS type,
         julianday(closed_date) - julianday(created_date) AS days,
         CASE WHEN ${NF_LIKE} THEN 1 ELSE 0 END AS nf
  FROM sr311
  WHERE closed_date IS NOT NULL AND created_date IS NOT NULL
    AND complaint_type IN ${TYPES}
    AND julianday(closed_date) >= julianday(created_date)
    AND council_district IS NOT NULL AND CAST(council_district AS INTEGER) > 0
`).all();

// Bucket close-times by district (overall + per type) and by borough.
const D = new Map();   // cd -> { borough tally, days:[], nf, byType:Map(type->{days:[],nf}) }
const B = new Map();   // borough -> { days:[], nf }
const cityDays = [], cityByType = new Map();
for (const row of closeRows) {
  const cd = String(parseInt(row.cd, 10));
  if (!D.has(cd)) D.set(cd, { boro: {}, days: [], nf: 0, byType: new Map() });
  const d = D.get(cd);
  d.days.push(row.days); d.nf += row.nf;
  d.boro[row.borough] = (d.boro[row.borough] || 0) + 1;
  if (!d.byType.has(row.type)) d.byType.set(row.type, { days: [], nf: 0 });
  const dt = d.byType.get(row.type); dt.days.push(row.days); dt.nf += row.nf;
  if (row.borough) { if (!B.has(row.borough)) B.set(row.borough, { days: [], nf: 0 }); const b = B.get(row.borough); b.days.push(row.days); b.nf += row.nf; }
  cityDays.push(row.days);
  if (!cityByType.has(row.type)) cityByType.set(row.type, []); cityByType.get(row.type).push(row.days);
}

// Close-TIME is kept as an honest secondary fact, but for these NYPD-handled types it's ~0 days
// citywide (they're closed almost instantly, everywhere) — so it does NOT discriminate. The metric
// that DOES vary by district, and is squarely on-thesis (closure ≠ resolution), is the DISMISSAL
// RATE: the share of a district's closed complaints the city marked "nothing found / could not
// locate." We rank on that. Computed per TYPE to control for complaint-mix (a legal-guardrail
// requirement: never manufacture a false pattern from an apples-to-oranges aggregate).
const cityMedian = plainMedian(cityDays);
const cityNf = [...D.values()].reduce((s, d) => s + d.nf, 0);
const cityN = cityDays.length;
const cityDismiss = cityN ? cityNf / cityN : 0;
const cityTypeDismiss = {}, cityTypeMedian = {};
for (const [t, arr] of cityByType) cityTypeMedian[t] = plainMedian(arr);
{
  const tNf = {}, tN = {};
  for (const d of D.values()) for (const [t, dt] of d.byType) { tNf[t] = (tNf[t] || 0) + dt.nf; tN[t] = (tN[t] || 0) + dt.days.length; }
  for (const t of Object.keys(tN)) cityTypeDismiss[t] = tN[t] ? tNf[t] / tN[t] : 0;
}

// Came-back rate per district (a second honest axis): closures followed by a new report, from the
// per-Issue returned_n/closed_n already computed. Aggregated over the district's clustered Issues.
const cbByD = new Map();
for (const r of issues) {
  const cd = parseInt(r.council || '0', 10); if (!cd) continue;
  const a = cbByD.get(cd) || { ret: 0, cl: 0 }; a.ret += num(r.returned_n); a.cl += num(r.closed_n); cbByD.set(cd, a);
}
const cbRate = cd => { const a = cbByD.get(cd); return a && a.cl ? +(a.ret / a.cl).toFixed(2) : null; };

// Per-district rows (only districts with enough closures to make a claim).
let districts = [...D.entries()].map(([cd, d]) => {
  const boro = Object.entries(d.boro).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const byType = {};
  for (const [t, dt] of d.byType) byType[t] = { n: dt.days.length, dismissal_rate: dt.days.length ? +(dt.nf / dt.days.length).toFixed(3) : 0, median_close_days: round1(plainMedian(dt.days)) };
  return { district: +cd, borough: boro, n: d.days.length,
           dismissal_rate: d.days.length ? +(d.nf / d.days.length).toFixed(3) : 0,
           came_back_rate: cbRate(+cd), median_close_days: round1(plainMedian(d.days)), byType };
}).filter(x => x.n >= MIN_DISTRICT_N);

// Rank by DISMISSAL RATE ascending: rank 1 = the district the city dismisses LEAST (best);
// rank N = dismissed most (worst). Ratio compares the district to the citywide dismissal rate.
districts.sort((a, b) => a.dismissal_rate - b.dismissal_rate);
const totalD = districts.length;
districts.forEach((x, i) => {
  x.rank = i + 1; x.total = totalD;
  x.ratio_vs_median = cityDismiss > 0 ? +(x.dismissal_rate / cityDismiss).toFixed(1) : null;
});

// Per-type district ranks (for the honest per-Issue badge: this block's type vs the same type citywide).
const typeRank = {};   // type -> Map(district -> {rank,total,ratio,rate})
for (const t of Object.keys(cityTypeDismiss)) {
  const rows = districts.filter(x => x.byType[t] && x.byType[t].n >= 40)
    .map(x => ({ district: x.district, rate: x.byType[t].dismissal_rate }))
    .sort((a, b) => a.rate - b.rate);
  const map = new Map();
  const cr = cityTypeDismiss[t];
  rows.forEach((r, i) => map.set(r.district, { rank: i + 1, total: rows.length, rate: r.rate, ratio_vs_median: cr > 0 ? +(r.rate / cr).toFixed(1) : null }));
  typeRank[t] = map;
}

// Borough roll-up (the legible headline unit) — same dismissal-rate ranking.
let boroughs = [...B.entries()].map(([boro, b]) => ({ borough: boro, n: b.days.length, dismissal_rate: b.days.length ? +(b.nf / b.days.length).toFixed(3) : 0, median_close_days: round1(plainMedian(b.days)) }));
boroughs.sort((a, b) => a.dismissal_rate - b.dismissal_rate);
boroughs.forEach((x, i) => { x.rank = i + 1; x.total = boroughs.length; x.ratio_vs_median = cityDismiss > 0 ? +(x.dismissal_rate / cityDismiss).toFixed(1) : null; });

// Only types with a real "nothing found" resolution signal can carry a defensible dismissal claim.
// Drug Activity / Panhandling resolutions don't use that language (~0% citywide), so a ratio there
// would be noise dressed as a pattern — excluded (legal-guardrail: no false patterns).
const VALID_TYPES = Object.keys(cityTypeDismiss).filter(t => cityTypeDismiss[t] >= 0.05);

// Stamp each Issue with its district's disparity (rank + ratio, for the per-card badge).
const districtByNum = new Map(districts.map(x => [x.district, x]));
for (const r of issues) {
  const cd = parseInt(r.council || '0', 10);
  const dstat = districtByNum.get(cd);
  const tr = typeRank[r.type] && typeRank[r.type].get(cd);
  if (dstat && tr && VALID_TYPES.includes(r.type)) {
    // rank_worst counts from the bad end (1 = most-dismissed) — the number the accusation cites.
    r.disparity = { rank: tr.rank, total: tr.total, rank_worst: tr.total - tr.rank + 1,
                    rate: tr.rate, ratio_vs_median: tr.ratio_vs_median,
                    district_rank: dstat.rank, district_total: dstat.total };
  }
}

// Precompute the per-type ranked district lists (worst = most-dismissed first) for the client view.
const ranked = {};
for (const t of VALID_TYPES) {
  ranked[t] = districts.filter(x => x.byType[t] && x.byType[t].n >= 40)
    .map(x => ({ district: x.district, borough: x.borough, n: x.byType[t].n,
                 dismissal_rate: x.byType[t].dismissal_rate,
                 ratio_vs_median: typeRank[t].get(x.district)?.ratio_vs_median ?? null }))
    .sort((a, b) => b.dismissal_rate - a.dismissal_rate)
    .map((x, i) => ({ ...x, rank_worst: i + 1 }));
  ranked[t].forEach(x => x.total = ranked[t].length);
}

const disparity = {
  generated: DATA_MAX_DATE,
  scope: 'quality-of-life 311 (Encampment, Homeless Person Assistance, Drug Activity, Panhandling)',
  metric: 'dismissal rate — share of a district’s closed complaints the city marked "nothing found / could not locate"',
  note_close_time: 'these complaint types are closed almost instantly citywide (~0 days), so close-TIME does not discriminate; median_close_days is reported for honesty, dismissal_rate is the ranked metric',
  valid_types: VALID_TYPES,
  citywide: { dismissal_rate: +cityDismiss.toFixed(3), median_close_days: round1(cityMedian), n: cityN,
              by_type: Object.fromEntries(Object.keys(cityTypeDismiss).map(t => [t, { dismissal_rate: +cityTypeDismiss[t].toFixed(3), median_close_days: round1(cityTypeMedian[t]) }])) },
  ranked, districts, boroughs,
};
const worst = districts.length ? districts[totalD - 1] : null;
console.log('disparity: districts', districts.length, '| city dismissal', (cityDismiss * 100).toFixed(0) + '% |',
  worst ? `most-dismissed = D${worst.district} (${worst.borough}) @ ${(worst.dismissal_rate * 100).toFixed(0)}% = ${worst.ratio_vs_median}× the citywide rate` : 'n/a');

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
atomicWrite(path.join(dataDir, 'disparity.json'), disparity);
console.log(`built ${issues.length} issues + ${trends.length} trend rows + ${disparity.districts.length} districts (atomic)`);

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
