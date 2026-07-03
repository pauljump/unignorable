// unignorable — zero-dep civic accountability map.
// City 311 data is the BAIT (their self-serving "resolved 100x"); citizen commentary is the TRUTH.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const ugc = require('./ugc');

// --- Geocode (OpenStreetMap Nominatim), proxied + cached server-side. NYC-bounded. ---
// Nominatim usage policy requires a descriptive User-Agent and an identifiable contact; bounded
// to NYC's viewbox so "3 Peter Cooper Rd" resolves to the right block, not a same-named street.
const NYC_VIEWBOX = '-74.2591,40.9176,-73.7004,40.4774'; // left,top,right,bottom
const GEO_UA = 'unignorable/1.0 (NYC 311 accountability map; +https://unignorable.polyfeeds.dev)';
const geoCache = new Map(); // LRU: query → JSON string of [{name,lat,lng}]
function geocode(q) {
  return new Promise((resolve, reject) => {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=0'
      + '&countrycodes=us&bounded=1&viewbox=' + encodeURIComponent(NYC_VIEWBOX)
      + '&q=' + encodeURIComponent(q);
    const req = https.get(url, { headers: { 'User-Agent': GEO_UA, 'Accept': 'application/json' } }, (r) => {
      let b = ''; r.on('data', c => b += c);
      r.on('end', () => {
        try {
          const arr = JSON.parse(b);
          const out = (Array.isArray(arr) ? arr : []).slice(0, 5).map(x => ({
            name: x.display_name, lat: +x.lat, lng: +x.lon,
          })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng));
          resolve(JSON.stringify(out));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(6000, () => req.destroy(new Error('geocode timeout')));
  });
}

const DIR = __dirname;
const PORT = process.env.PORT || 8000;
const ISSUES = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'issues.json'), 'utf8'));
const TRENDS = fs.readFileSync(path.join(DIR, 'data', 'trends.json'));

// Accountable-officials roster (council district -> member + contact + X handle, Mayor's CAU).
// Optional: the receipt page degrades to "district N + look-up link" if the file isn't present yet.
let OFFICIALS = { council: {}, cau: null, borough_presidents: {} };
try { OFFICIALS = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'officials.json'), 'utf8')); } catch {}

// Community boards data (for cb_agenda action template). Degrades gracefully if missing.
let COMMUNITY_BOARDS = {};
try { COMMUNITY_BOARDS = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'community_boards.json'), 'utf8')); } catch {}

// Press tip lines (for press_tip action template). Degrades gracefully if missing.
let PRESS_TIPS = {};
try { PRESS_TIPS = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'press_tips.json'), 'utf8')); } catch {}

// Action type registry — DATA, not code. Actions are addable as a row with no server rebuild.
let ACTION_TYPES = [];
try { ACTION_TYPES = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'action_types.json'), 'utf8')); } catch {}
// Allowlist: enabled, non-coming action ids (instant|prepared|external).
const TRACKABLE_ACTIONS = new Set(
  ACTION_TYPES.filter(a => a.enabled && a.kind !== 'coming').map(a => a.id)
);

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || 'https://unignorable.polyfeeds.dev';

// Photo store — the proof layer 311 open data structurally can't have. Bytes on disk, served by id.
const PHOTO_DIR = path.join(DIR, 'data', 'photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PHOTO_MAX = 2_000_000;  // ~2MB of decoded bytes; the client downscales to ~1280px JPEG (< this)

// Decode a data-URL photo, validate, write to disk. Returns filename or null (best-effort, never throws).
function savePhoto(dataUrl) {
  try {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(dataUrl || '');
    if (!m) return null;
    const ext = PHOTO_TYPES[m[1]];
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > PHOTO_MAX) return null;
    const name = crypto.randomBytes(9).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(PHOTO_DIR, name), buf);
    return name;
  } catch { return null; }
}

const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Basic per-IP write limiter — first guard on the open, anonymous post path (full moderation still TODO).
const WINDOW_MS = 5 * 60 * 1000, MAX_WRITES = 12;
const hits = new Map();
const clientIp = (req) =>
  req.headers['cf-connecting-ip'] ||
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress || 'unknown';
function rateLimited(req) {
  const ip = clientIp(req), now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_WRITES) { hits.set(ip, recent); return true; }
  recent.push(now); hits.set(ip, recent);
  return false;
}

const key = (type, id) => type + '|' + id;
const send = (res, code, body, type) => {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
};
// Gzip a response body when the client accepts it, falling back to identity otherwise.
// The 6.26 MB /api/issues blob is render-blocking; gzip cuts it ~89% with zero new deps.
const sendMaybeGzip = (req, res, body, type) => {
  const ae = req.headers['accept-encoding'] || '';
  if (/\bgzip\b/.test(ae)) {
    const gz = Buffer.isBuffer(body) && body._gz ? body._gz : zlib.gzipSync(body);
    res.writeHead(200, { 'Content-Type': type, 'Content-Encoding': 'gzip',
      'Vary': 'Accept-Encoding', 'Access-Control-Allow-Origin': '*' });
    return res.end(gz);
  }
  return send(res, 200, body, type);
};

// --- SEVERITY RANK PRECOMPUTATION ---
// Two sorted-index maps keyed by issue_key:
//   SEVERITY_CITY[key]     = rank among active same-type issues citywide (1 = most severe)
//   SEVERITY_DISTRICT[key] = rank among active same-type issues within the same council district
// Computed once at server start; never hardcoded. Contract requires same-type ranking by score desc.
const SEVERITY_CITY = new Map();
const SEVERITY_DISTRICT = new Map();
{
  // Group active issues by type; sort each group by score desc.
  const byType = {};
  for (const i of ISSUES) {
    if (i.status !== 'active') continue;
    if (!byType[i.type]) byType[i.type] = [];
    byType[i.type].push(i);
  }
  for (const type of Object.keys(byType)) {
    const sorted = byType[type].slice().sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    sorted.forEach((iss, idx) => SEVERITY_CITY.set(key(iss.type, iss.id), { rank: idx + 1, total: sorted.length }));
  }

  // Group active issues by type+district; sort each group by score desc.
  const byTypeDistrict = {};
  for (const i of ISSUES) {
    if (i.status !== 'active') continue;
    const dk = i.type + '|d' + parseInt(i.council || '0', 10);
    if (!byTypeDistrict[dk]) byTypeDistrict[dk] = [];
    byTypeDistrict[dk].push(i);
  }
  for (const dk of Object.keys(byTypeDistrict)) {
    const sorted = byTypeDistrict[dk].slice().sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    sorted.forEach((iss, idx) => SEVERITY_DISTRICT.set(key(iss.type, iss.id), { rank: idx + 1, total: sorted.length }));
  }
}

// Cache the (large, static-ish) issues payload + its gzip, keyed on a cheap signature of the
// dynamic `seen` counts AND the campaign-key set. Counts change only when an approved report lands;
// campaign set changes when a campaign is created. This ensures new campaigns appear without restart.
let ISSUES_CACHE = null; // { sig, raw:Buffer, gz:Buffer }
function issuesPayload() {
  const counts = ugc.countsAll();
  const campaignKeys = new Set(ugc.allCampaigns().map(c => c.issue_key));
  // Signature includes campaign key set so new campaigns bust the cache.
  const sig = JSON.stringify(counts) + '|' + JSON.stringify([...campaignKeys].sort());
  if (ISSUES_CACHE && ISSUES_CACHE.sig === sig) return ISSUES_CACHE;
  const out = ISSUES.map(({ episodes, headline_kind, nothing_found, ...i }) =>
    ({ ...i, seen: counts[key(i.type, i.id)] || 0, campaign: campaignKeys.has(key(i.type, i.id)) }));
  const raw = Buffer.from(JSON.stringify(out));
  ISSUES_CACHE = { sig, raw, gz: zlib.gzipSync(raw) };
  return ISSUES_CACHE;
}
const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
});

// Review key — Paul's personal gate. Stable secret in data/admin-key (gitignored), generated once.
const KEY_FILE = path.join(DIR, 'data', 'admin-key');
let REVIEW_KEY = process.env.REVIEW_KEY || '';
if (!REVIEW_KEY) {
  try { REVIEW_KEY = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch {}
  if (!REVIEW_KEY) { REVIEW_KEY = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(KEY_FILE, REVIEW_KEY); }
}
const authed = (u) => REVIEW_KEY && u.searchParams.get('k') === REVIEW_KEY;

// A report attaches to a city Issue; that Issue carries the location/type a 311 filing needs.
const ISSUE_BY_KEY = new Map(ISSUES.map(i => [key(i.type, i.id), i]));
const issueMeta = (issueKey) => {
  const i = ISSUE_BY_KEY.get(issueKey);
  if (!i) return { type: issueKey.split('|')[0], addr: null };
  return { type: i.type, addr: i.addr, borough: i.borough, council: i.council,
           board: i.board, agency: i.agency, lat: i.lat, lng: i.lng };
};

// ---------- The RECEIPT: a public, named, dated accountability page for ONE Issue ----------
// Server-rendered (so it unfurls on X/iMessage and prints clean). Names the PUBLIC OFFICIAL in
// their OFFICIAL capacity using the city's OWN 311 record. Never names the people in the encampment.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = (x) => Math.round(Number(x) || 0).toLocaleString('en-US');
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();
const daysSince = (iso) => {
  const t = Date.parse((iso || '') + 'T00:00:00Z');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};
const fmtYears = (d) => d == null ? '' : (d >= 365 ? (d / 365).toFixed(d >= 730 ? 0 : 1) + ' years' : Math.round(d / 30) + ' months');

// Format a date ISO string as "Month D, YYYY" (e.g. "September 9, 2025").
const fmtDate = (iso) => {
  const t = Date.parse((iso || '') + 'T00:00:00Z');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

// Resolve the accountable council member from the issue's (zero-padded) district code.
function councilFor(council) {
  const n = parseInt(String(council || '').match(/\d+/)?.[0] || '', 10);
  if (!Number.isFinite(n)) return null;
  const m = OFFICIALS.council && OFFICIALS.council[String(n)];
  return m ? { district: n, ...m } : { district: n };
}

// Two-tier publicness. A verified district lets the page NAME the member (a deliberate artifact you
// post). INDEXING (Google + sitemap) needs more: the case must be live AND substantive — so a search
// engine never surfaces an official's name over a stale, trivial, or long-resolved blip.
const INDEX_MIN_SCORE = 45;
function isIndexable(i) {
  const m = councilFor(i.council);
  if (!(m && m.member && m.verified)) return false;
  return i.status === 'active' && (Number(i.score) || 0) >= INDEX_MIN_SCORE;
}

// Inline-SVG episode timeline: each continuous run of reports as a band on a first-seen->today axis.
function sparkline(issue) {
  const eps = Array.isArray(issue.episodes) ? issue.episodes : [];
  if (!eps.length) return '';
  const t0 = Date.parse(issue.first_seen + 'T00:00:00Z');
  const t1 = Date.now();
  const span = Math.max(1, t1 - t0);
  const W = 100, H = 14;
  const bands = eps.map(([a, b]) => {
    const x = ((Date.parse(a + 'T00:00:00Z') - t0) / span) * W;
    const w = Math.max(0.6, ((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / span) * W);
    return `<rect x="${x.toFixed(2)}" y="3" width="${w.toFixed(2)}" height="8" rx="1.5" fill="#ff4d4d"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:18px;display:block">`
    + `<line x1="0" y1="7" x2="100" y2="7" stroke="#2a2f37" stroke-width="0.5"/>${bands}</svg>`;
}

// What the law says — only for types with a clean, citable ordinance. We deliberately attach NO
// penalty to service-call types (Homeless Person Assistance) or protected conduct (Panhandling):
// asserting criminality there is rebuttable. A sidewalk structure is the clean case.
const LAW = {
  'Encampment': {
    code: 'NYC Admin. Code § 16-122',
    rule: 'It is unlawful to erect a shed, structure, or other obstruction, or to leave movable property, upon any public street or sidewalk.',
    penalty: 'Fine of $50 to $250, up to 10 days imprisonment, or both, per offense.',
    also: 'Blocking the pedestrian right-of-way is separately prohibited under § 19-136.',
    src: 'https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-26202',
  },
};

// Humanize a duration for the hero headline ("9 months", "2 years"). Time is the gut-punch.
const humanizeDur = (days) => {
  if (days == null || !Number.isFinite(days)) return '';
  if (days >= 365) { const y = days / 365; return (y >= 2 ? Math.round(y) + ' years' : y.toFixed(1).replace(/\.0$/, '') + ' years'); }
  if (days >= 55) return Math.round(days / 30.4) + ' months';
  if (days >= 13) return Math.round(days / 7) + ' weeks';
  return Math.max(1, Math.round(days)) + ' days';
};
const monthYear = (iso) => { const t = Date.parse((iso || '') + 'T00:00:00Z'); return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { month: 'long', year: 'numeric' }) : ''; };

// ---- ESCALATION LADDER (pure function, no timers, no auto-sends) ----
// Rungs derive from campaign age (days since campaign.started_at) and which action_types are logged.
// current rung = first unlocked-and-undone rung; if all unlocked are done, next = next locked rung.
// Recurrence: if the issue's latest episode start is AFTER campaign.started_at, re-prompt email_official.
const LADDER_RUNGS = [
  { day: 0,  action_type: 'email_official',    label: 'Email the council member with the city\'s own record.' },
  { day: 7,  action_type: 'request_cb_agenda', label: 'Ask the community board to put this on the agenda.' },
  { day: 14, action_type: 'tip_press',          label: 'Tip a local newsroom.' },
  { day: 21, action_type: 'share_card',         label: 'Make it public: post the receipt card.' },
];

function ladderState(campaign, issue, actionCountsObj) {
  const campaignAgeDays = daysSince((campaign.started_at || '').slice(0, 10)) || 0;
  // Recurrence: if latest episode started after campaign creation, flag it.
  const eps = Array.isArray(issue.episodes) ? issue.episodes : [];
  const latestEpStart = eps.length ? eps[eps.length - 1][0] : null;
  const recurrence = latestEpStart && latestEpStart > (campaign.started_at || '').slice(0, 10);

  // Build rung states.
  const rungs = LADDER_RUNGS.map(r => {
    const done = ugc.hasAction(campaign.issue_key, r.action_type);
    const unlocked = campaignAgeDays >= r.day;
    return { ...r, done, unlocked };
  });

  // Current rung = first unlocked-and-undone; fall back to last unlocked undone; else next locked.
  let currentRung = rungs.find(r => r.unlocked && !r.done) || null;
  if (!currentRung) {
    // All unlocked are done — show next locked rung with unlock day.
    currentRung = rungs.find(r => !r.unlocked) || null;
  }

  return { rungs, currentRung, campaignAgeDays, recurrence };
}

// ---- PREPARED ACTION TEMPLATES ----
// Each template builder returns a { href, logOnClick } object.
// href = the mailto: or X intent URL. These are prepare-and-hand-to-human — server never sends.
// The CAU fallback email is used when the member contact is missing or unverified.
const CAU_EMAIL = (OFFICIALS.cau && OFFICIALS.cau.email) || 'constituentservices@cau.nyc.gov';

// THE ASK block per complaint type. Service-first, no criminal claim for non-structure types.
function askForType(type) {
  if (type === 'Encampment') {
    return [
      'Clear the sidewalk obstruction. NYC Admin Code §16-122 and §19-136 give the city clear authority to act on persistent sidewalk obstructions.',
      'Connect these neighbors to services. File this location as an outreach request to DHS so the people here are offered shelter and help. Clearing without serving just moves the problem.',
      'Make it durable. When the city last did this right (Sheepshead Bay), it cleared the site and prevented its return. Closing a ticket is not the same as fixing the problem.',
    ];
  }
  if (type === 'Homeless Person Assistance') {
    return [
      'Ensure outreach is reaching this location. Request that DHS street outreach teams make contact with the individuals here and offer shelter, services, and connections to care.',
      'Connect people to services. The goal is stable housing and support, not removal.',
      'Follow up in writing. Ask for a status update within 30 days on what outreach occurred and what was offered.',
    ];
  }
  if (type === 'Drug Activity' || type === 'Panhandling') {
    return [
      'Ensure the appropriate agency is actively responding to reports at this location.',
      'Provide a written status update on what response has occurred at this address.',
      'Connect any individuals in need to available city services and outreach programs.',
    ];
  }
  return [
    'Put this location on the relevant agency\'s active outreach and response list.',
    'Report back in writing on what the city found and what action was taken.',
    'Ensure this block receives a follow-up visit within 30 days.',
  ];
}

// email_official: pre-filled mailto to district council member (falls back to CAU).
function buildEmailOfficialUrl(issue, campaign) {
  const m = councilFor(issue.council);
  const verified = !!(m && m.member && m.verified);
  const toEmail = verified ? m.email : CAU_EMAIL;
  const toName = verified ? m.member : 'Council Member';
  const addr = titleCase(issue.addr) || 'this location';

  // Live numbers from the issue record.
  const eps = Array.isArray(issue.episodes) ? issue.episodes : [];
  const curEp = eps.length ? eps[eps.length - 1] : null;
  const epStart = curEp ? curEp[0] : (issue.first_seen || '');
  const epStartFmt = fmtDate(epStart);
  const dayN = daysSince(epStart) || 0;
  const cn = Number(issue.closed_n) || 0;
  const nf = Number(issue.nothing_found) || 0;
  const n = Number(issue.n) || 0;

  const receiptUrl = `${PUBLIC_ORIGIN}/c?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`;
  const askLines = askForType(issue.type);

  const subject = `[Constituent Request] Persistent ${issue.type} at ${addr} (${dayN} days open, City Case on Record)`;

  const body = [
    `Dear ${toName},`,
    '',
    `I am writing as a constituent about a persistent ${issue.type.toLowerCase()} situation at ${addr} that has been active since ${epStartFmt}, now ${dayN} days without resolution.`,
    '',
    `The city\'s own 311 record shows:`,
    `- ${n} total reports filed for this location`,
    `- ${cn} times the city marked the case "resolved"`,
    nf ? `- ${nf} of those closures stated "nothing found"` : '',
    '',
    `The situation is currently open and active according to the city\'s own data.`,
    '',
    `I am asking your office to:`,
    ...askLines.map((a, i) => `${i + 1}. ${a}`),
    '',
    `The full city record for this location is at: ${receiptUrl}`,
    '',
    `Please respond with the steps your office is taking and a timeline for resolution.`,
    '',
    `Thank you for your attention to this matter.`,
    '',
    `[Your name]`,
    `[Your address]`,
  ].filter(l => l !== null && l !== undefined).join('\n');

  return `mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// cb_agenda: pre-filled mailto to community board district manager (falls back to CAU).
function buildCbAgendaUrl(issue) {
  const boardCode = issue.board || '';
  const cbData = COMMUNITY_BOARDS[boardCode];
  const toEmail = (cbData && cbData.email) ? cbData.email : CAU_EMAIL;
  const boardName = (cbData && cbData.board) ? cbData.board : `Community Board (${boardCode || 'district'})`;
  const addr = titleCase(issue.addr) || 'this location';
  const receiptUrl = `${PUBLIC_ORIGIN}/c?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`;
  const dayN = daysSince((Array.isArray(issue.episodes) && issue.episodes.length ? issue.episodes[issue.episodes.length - 1][0] : issue.first_seen)) || 0;

  const subject = `Agenda Item Request: ${issue.type} at ${addr} (${dayN} days open)`;
  const body = [
    `Dear District Manager,`,
    '',
    `I am writing to request that the following matter be placed on the agenda for ${boardName}\'s next full board or relevant committee meeting.`,
    '',
    `Location: ${addr}`,
    `Issue type: ${issue.type}`,
    `Duration of current episode: ${dayN} days`,
    `City 311 reports filed: ${fmtN(issue.n)}`,
    '',
    `The full public record from NYC 311 open data is available here: ${receiptUrl}`,
    '',
    `I believe the community board\'s attention is warranted given the duration of this issue and the documented response history. I respectfully request that this item be scheduled for the next available meeting and that a written update be provided to constituents.`,
    '',
    `Thank you.`,
    '',
    `[Your name]`,
    `[Your address]`,
  ].join('\n');

  return `mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// press_tip: pre-filled mailto to primary local press (Town and Village for canary; fallback to THE CITY).
function buildPressTipUrl(issue) {
  const primary = PRESS_TIPS.primary;
  const fallback = (PRESS_TIPS.secondary && PRESS_TIPS.secondary[0]);
  const outlet = primary || fallback;
  const toEmail = (outlet && outlet.email) ? outlet.email : CAU_EMAIL;
  const outletName = (outlet && outlet.name) ? outlet.name : 'local newsroom';
  const addr = titleCase(issue.addr) || 'this location';
  const receiptUrl = `${PUBLIC_ORIGIN}/c?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`;
  const dayN = daysSince((Array.isArray(issue.episodes) && issue.episodes.length ? issue.episodes[issue.episodes.length - 1][0] : issue.first_seen)) || 0;

  const subject = `Tip: ${issue.type} at ${addr} (${dayN} days, documented in city data)`;
  const body = [
    `Hi ${outletName} team,`,
    '',
    `I wanted to flag a situation that may be worth covering.`,
    '',
    `There is a persistent ${issue.type.toLowerCase()} at ${addr} that has been active for ${dayN} days. According to NYC\'s own 311 open data, the city has received ${fmtN(issue.n)} reports and closed the case ${fmtN(Number(issue.closed_n) || 0)} times.`,
    '',
    `The full documented record, built entirely from city data, is publicly available here: ${receiptUrl}`,
    '',
    `I am a constituent who has been following this situation and wanted to make sure it was on your radar.`,
    '',
    `[Your name]`,
    `[Your contact, optional]`,
  ].join('\n');

  return `mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// share: X intent URL + copy-link (the external action row renders both).
function buildShareUrl(issue) {
  const m = councilFor(issue.council);
  const tag = (m && m.x) ? `@${m.x.replace(/^@/, '')} ` : '';
  const addr = titleCase(issue.addr) || 'this location';
  const active = issue.status === 'active';
  const eps = Array.isArray(issue.episodes) ? issue.episodes : [];
  const curEp = eps.length ? eps[eps.length - 1] : null;
  const epStart = curEp ? curEp[0] : issue.first_seen;
  const dayN = daysSince(epStart) || 0;
  const durTxt = humanizeDur(dayN);
  const cn = Number(issue.closed_n) || 0;
  const n = Number(issue.n) || 0;

  const shareUrl = `${PUBLIC_ORIGIN}/c?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`;
  const tweet = `${tag}`
    + (active && durTxt ? `There\'s been a tent at ${addr} for ${durTxt}. ` : `${addr}: `)
    + `NYC 311 was told ${fmtN(n)} times and closed it ${fmtN(cn)} times. ${active ? 'Still here. ' : ''}`
    + `Clear the sidewalk AND connect these neighbors to services. The record:`;
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(shareUrl)}`;
  return { tweetUrl, shareUrl };
}

// ---- CAMPAIGN PAGE (superset of the receipt) ----
// Renders at /i, /issue, /c, /campaign. Identical output.
// Layout: Day-N hero -> severity line -> THE ASK -> evidence block -> action rail -> momentum -> UGC thread.
function renderCampaign(issue) {
  const issueKey = key(issue.type, issue.id);
  const addr = titleCase(issue.addr) || 'this location';
  const boro = titleCase(issue.borough);
  const area = boro ? `${addr}, ${boro}` : addr;
  const known = daysSince(issue.first_seen);
  const nf = Number(issue.nothing_found) || 0;
  const cn = Number(issue.closed_n) || 0;
  const rn = Number(issue.returned_n) || 0;
  const ard = (issue.avg_return_days != null && Number.isFinite(issue.avg_return_days)) ? issue.avg_return_days : null;
  const m = councilFor(issue.council);
  const verified = !!(m && m.member && m.verified);
  const law = LAW[issue.type];
  const cau = OFFICIALS.cau;
  const active = issue.status === 'active';
  const yrsTxt = fmtYears(known) || 'years';

  // Campaign permalink uses /c.
  const shareUrl = `${PUBLIC_ORIGIN}/c?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`;
  const mapUrl = `${PUBLIC_ORIGIN}/map?focus=${encodeURIComponent(issue.type + '|' + issue.id)}`;

  // Current episode start — computed LIVE at render (not the stale current_days field).
  const eps = Array.isArray(issue.episodes) ? issue.episodes : [];
  const curEp = eps.length ? eps[eps.length - 1] : null;
  const episodeStart = curEp ? curEp[0] : issue.first_seen;
  // Day-N: computed live from episode start, not stored.
  const dayN = daysSince(episodeStart) || 0;
  const instReports = curEp ? curEp[2] : issue.n;
  const durTxt = humanizeDur(dayN);
  const startTxt = monthYear(episodeStart);

  // The citizen layer, on top of the city's record.
  let T = { corrob: 0, posts: [], verdict: 'unverified' };
  try { T = ugc.thread(issueKey); } catch {}
  const corrob = T.corrob || 0;
  const latest = (T.posts && T.posts[0]) || null;

  // Campaign record (may not exist yet — page renders either way).
  let campaign = null;
  try { campaign = ugc.getCampaign(issueKey); } catch {}
  let ladder = null;
  let actionCts = { total: 0, byType: {}, thisWeek: { total: 0, byType: {} } };
  if (campaign) {
    try { actionCts = ugc.actionCounts(issueKey); } catch {}
    try { ladder = ladderState(campaign, issue, actionCts); } catch {}
  }

  // Severity rank (precomputed, never hardcoded).
  const sevCity = SEVERITY_CITY.get(issueKey);
  const sevDist = SEVERITY_DISTRICT.get(issueKey);
  const districtNum = m ? m.district : null;
  let severityLine = '';
  if (active && sevCity && sevDist) {
    severityLine = `#${sevCity.rank} most severe active ${esc(issue.type)} citywide (by severity score) &middot; #${sevDist.rank} in District ${districtNum || esc(issue.council || '')}`;
  } else if (active && sevCity) {
    severityLine = `#${sevCity.rank} most severe active ${esc(issue.type)} citywide (by severity score)`;
  }

  // Title/OG — lead with TIME (the gut-punch), keep the counts for the indictment below.
  const ogTitle = active && durTxt
    ? `A tent has been here ${durTxt}. The city has known the whole time.`
    : `${area}: ${fmtN(issue.n)} reports on the city's own record.`;
  const ogDesc = `Reported ${fmtN(issue.n)} times to NYC 311 over ${yrsTxt}; the city closed it ${fmtN(cn)} times`
    + (active ? `. Still here.` : '.')
    + (verified ? ` Accountable: Council Member ${m.member}.` : '');

  // X share (uses /c permalink).
  const tag = (m && m.x) ? `@${m.x.replace(/^@/, '')} ` : '';
  const tweet = `${tag}`
    + (active && durTxt ? `There's been a tent at ${addr} for ${durTxt}. ` : `${addr}: `)
    + `NYC 311 was told ${fmtN(issue.n)} times and closed it ${fmtN(cn)} times. ${active ? 'Still here. ' : ''}`
    + `Clear the sidewalk AND connect these neighbors to services. Your move.`;
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(shareUrl)}`;

  // Accountable-official card.
  let officialBlock;
  if (verified) {
    const contacts = [
      m.x ? `<a href="https://twitter.com/${esc(m.x.replace(/^@/, ''))}">@${esc(m.x.replace(/^@/, ''))}</a>` : '',
      m.phone ? esc(m.phone) : '',
      m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : '',
    ].filter(Boolean).join(' &middot; ');
    officialBlock = `<div class="who-name">${esc(m.member)}</div>`
      + `<div class="who-role">NYC Council Member, District ${m.district}${m.borough ? ' &middot; ' + esc(m.borough) : ''}</div>`
      + (contacts ? `<div class="who-contact">${contacts}</div>` : '')
      + `<div class="who-now">Represents this block today. ${issue.status === 'active'
          ? 'It is still here on their watch and within their power to move DHS, Sanitation, and NYPD on it now.'
          : 'The record is theirs to answer for.'}</div>`;
  } else {
    const dn = m && m.district ? m.district : (issue.council || '?');
    officialBlock = `<div class="who-name">Council District ${esc(dn)}</div>`
      + `<div class="who-contact"><a href="https://council.nyc.gov/districts/">Find &amp; name the member &#8594;</a></div>`;
  }

  const stamp = `Built from New York City's own 311 open data (dataset erm2-nwe9)`
    + (issue.last_seen ? `, current through ${esc(issue.last_seen)}` : '') + '.';

  // THE ASK lines for this issue type.
  const askLines = askForType(issue.type);

  // Action rail — iterate ACTION_TYPES, build controls.
  // For prepared actions: build mailto/intent href; onclick logs to /api/act then proceeds.
  const actScript = `<script>
function logAct(actionType){
  fetch('/api/act',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action_type:actionType,type:${JSON.stringify(issue.type)},id:${JSON.stringify(issue.id)}})
  }).catch(()=>{});
}
function copyLink(url){
  navigator.clipboard && navigator.clipboard.writeText(url).then(()=>{
    var el=document.getElementById('copy-link-btn');
    if(el){var orig=el.textContent;el.textContent='Copied!';setTimeout(()=>{el.textContent=orig;},1500);}
  }).catch(()=>{ window.prompt('Copy this link:',url); });
}
</script>`;

  // Build the action rail HTML.
  let actionRailHtml = '';
  for (const at of ACTION_TYPES) {
    if (!at.enabled && at.kind !== 'coming') continue;
    const isComingKind = at.kind === 'coming' || !at.enabled;
    const iconHtml = at.icon ? `<span class="act-icon">${at.icon}</span>` : '';

    if (isComingKind) {
      actionRailHtml += `<div class="act-row act-coming" aria-disabled="true">
        <div class="act-meta">${iconHtml}<div><div class="act-title">${esc(at.title)}</div><div class="act-desc">${esc(at.desc)}</div></div></div>
      </div>`;
      continue;
    }

    if (at.id === 'corroborate') {
      // instant — logs to /api/seen (corroboration) AND /api/act (momentum). Two counters, intentional.
      actionRailHtml += `<div class="act-row">
        <div class="act-meta">${iconHtml}<div><div class="act-title">${esc(at.title)}</div><div class="act-desc">${esc(at.desc)}</div></div></div>
        <button class="act-btn" onclick="
          fetch('/api/seen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:${JSON.stringify(issue.type)},id:${JSON.stringify(issue.id)}})}).catch(()=>{});
          logAct('corroborate');
          this.textContent='Confirmed';this.disabled=true;
        ">Confirm</button>
      </div>`;
      continue;
    }

    if (at.id === 'testify') {
      // opens the UGC post composer (handled by existing /api/post flow on the map page).
      // Here on the campaign page, link to the map with the card open.
      const mapWithFocus = `${PUBLIC_ORIGIN}/map?focus=${encodeURIComponent(issueKey)}`;
      actionRailHtml += `<div class="act-row">
        <div class="act-meta">${iconHtml}<div><div class="act-title">${esc(at.title)}</div><div class="act-desc">${esc(at.desc)}</div></div></div>
        <a class="act-btn" href="${esc(mapWithFocus)}" onclick="logAct('testify')" target="_blank" rel="noopener">Add report</a>
      </div>`;
      continue;
    }

    if (at.id === 'email_official') {
      const mailto = buildEmailOfficialUrl(issue, campaign);
      actionRailHtml += `<div class="act-row">
        <div class="act-meta">${iconHtml}<div><div class="act-title">${esc(at.title)}</div><div class="act-desc">${esc(at.desc)}</div></div></div>
        <a class="act-btn" href="${esc(mailto)}" onclick="logAct('email_official')">Email</a>
      </div>`;
      continue;
    }

    if (at.id === 'request_cb_agenda') {
      const mailto = buildCbAgendaUrl(issue);
      actionRailHtml += `<div class="act-row">
        <div class="act-meta">${iconHtml}<div><div class="act-title">${esc(at.title)}</div><div class="act-desc">${esc(at.desc)}</div></div></div>
        <a class="act-btn" href="${esc(mailto)}" onclick="logAct('request_cb_agenda')">Request</a>
      </div>`;
      continue;
    }

    if (at.id === 'share_card') {
      const { tweetUrl: tUrl, shareUrl: sUrl } = buildShareUrl(issue);
      actionRailHtml += `<div class="act-row">
        <div class="act-meta">${iconHtml}<div><div class="act-title">${esc(at.title)}</div><div class="act-desc">${esc(at.desc)}</div></div></div>
        <div class="act-btn-group">
          <a class="act-btn" href="${esc(tUrl)}" onclick="logAct('share_card')" target="_blank" rel="noopener">Post to X</a>
          <button class="act-btn act-btn-ghost" id="copy-link-btn" onclick="logAct('share_card');copyLink(${JSON.stringify(sUrl)})">Copy link</button>
        </div>
      </div>`;
      continue;
    }

    if (at.id === 'tip_press') {
      const mailto = buildPressTipUrl(issue);
      actionRailHtml += `<div class="act-row">
        <div class="act-meta">${iconHtml}<div><div class="act-title">${esc(at.title)}</div><div class="act-desc">${esc(at.desc)}</div></div></div>
        <a class="act-btn" href="${esc(mailto)}" onclick="logAct('tip_press')">Send tip</a>
      </div>`;
      continue;
    }
  }

  // Momentum feed — from actionCounts.thisWeek.
  const wkTotal = actionCts.thisWeek.total || 0;
  const wkByType = actionCts.thisWeek.byType || {};
  let momentumHtml;
  if (wkTotal > 0) {
    const parts = [];
    if (wkByType.email_official) parts.push(`${wkByType.email_official} email${wkByType.email_official !== 1 ? 's' : ''}`);
    if (wkByType.share_card) parts.push(`${wkByType.share_card} share${wkByType.share_card !== 1 ? 's' : ''}`);
    if (wkByType.corroborate) parts.push(`${wkByType.corroborate} confirmation${wkByType.corroborate !== 1 ? 's' : ''}`);
    const partsStr = parts.length ? `: ${parts.join(', ')}` : '';
    momentumHtml = `<div class="momentum">${wkTotal} neighbor${wkTotal !== 1 ? 's' : ''} acted this week${partsStr}.</div>`;
  } else {
    momentumHtml = `<div class="momentum seed">Be the first to act on this today.</div>`;
  }

  // Ladder: the current prompted action (if a campaign exists).
  let ladderHtml = '';
  if (ladder && ladder.currentRung) {
    const rung = ladder.currentRung;
    if (rung.done) {
      ladderHtml = `<div class="ladder done">Next action: all current rungs complete. Keep the pressure on.</div>`;
    } else if (!rung.unlocked) {
      ladderHtml = `<div class="ladder locked">Next action in ${rung.day - ladder.campaignAgeDays} days: ${esc(rung.label)}</div>`;
    } else {
      const recurrenceNote = ladder.recurrence ? ' <b>A new flare-up has started. Re-engage the official with the updated record.</b>' : '';
      ladderHtml = `<div class="ladder active">Next action: ${esc(rung.label)}${recurrenceNote}</div>`;
    }
  }

  const stat = (big, label, alarm) =>
    `<div class="stat"><div class="big ${alarm ? 'alarm' : ''}">${big}</div><div class="lbl">${label}</div></div>`;

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="${isIndexable(issue) ? 'index,follow' : 'noindex'}">
<title>${esc(ogTitle)}</title>
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:url" content="${esc(shareUrl)}">
<meta property="og:site_name" content="unignorable">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(ogDesc)}">
<style>
  :root{--bg:#0b0d10;--card:#14171c;--ink:#e8eaed;--mut:#8b9098;--line:#262b32;--alarm:#ff4d4d;--amber:#ffb020}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  a{color:var(--amber)}
  .wrap{max-width:680px;margin:0 auto;padding:20px 18px 64px}
  .mast{display:flex;align-items:center;justify-content:space-between;padding:6px 0 18px;border-bottom:1px solid var(--line)}
  .word{font-weight:800;letter-spacing:.06em;font-size:14px;color:var(--ink);text-decoration:none}
  .word b{color:var(--alarm)}
  .tag{font-size:11px;color:var(--mut)}
  .hero{padding:24px 0 4px}
  .day-hero{font-size:72px;line-height:.92;font-weight:800;letter-spacing:-.02em;margin:6px 0 2px;color:var(--alarm)}
  .day-sub{font-size:14px;color:var(--mut);margin:4px 0 0}
  .dur{font-size:62px;line-height:.92;font-weight:800;letter-spacing:-.02em;margin:6px 0 2px}
  .lead{font-size:18px;line-height:1.42;margin:10px 0 0;color:var(--ink)}
  .severity{font-size:13px;color:var(--mut);margin:8px 0 0;letter-spacing:.01em}
  .indict{font-size:16px;line-height:1.5;background:var(--card);border:1px solid var(--line);border-left:3px solid var(--alarm);border-radius:10px;padding:14px 16px;margin:18px 0}
  .indict b{color:var(--alarm)}
  .ugc{margin:16px 0 6px;font-size:15px}
  .ugc .hdr b{color:#3ddc84}
  .ugc .q{margin-top:9px;padding:12px 14px;background:#11161d;border-radius:10px;border-left:3px solid var(--amber);font-size:14px;color:var(--ink);font-style:italic}
  details.record{margin:20px 0 0;border-top:1px solid var(--line)}
  details.record>summary{cursor:pointer;list-style:none;padding:16px 0 4px;font-weight:800;color:var(--amber);font-size:15px}
  details.record>summary::-webkit-details-marker{display:none}
  details.record[open]>summary{color:var(--mut)}
  .disclose{font-size:13px;color:var(--mut);line-height:1.55}
  .kicker{margin:22px 0 4px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--alarm);font-weight:700}
  h1{margin:0 0 6px;font-size:27px;line-height:1.18;font-weight:800}
  .sub{color:var(--mut);font-size:15px;margin:0 0 18px}
  .clock{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--alarm);border-radius:10px;padding:14px 16px;margin:14px 0 20px}
  .clock .n{font-size:34px;font-weight:800;color:var(--alarm);line-height:1}
  .clock .c{color:var(--mut);font-size:13px;margin-top:4px}
  .headline{font-size:19px;font-weight:700;margin:18px 0 8px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0 8px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 10px;text-align:center}
  .stat .big{font-size:22px;font-weight:800}
  .stat .big.alarm{color:var(--alarm)}
  .stat .lbl{font-size:11px;color:var(--mut);margin-top:3px;line-height:1.3}
  .spark{margin:16px 0 6px}
  .spark .cap{font-size:11px;color:var(--mut);margin-bottom:4px}
  h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);margin:30px 0 10px;font-weight:700}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
  .who-name{font-size:20px;font-weight:800}
  .who-role{color:var(--mut);font-size:13px;margin-top:2px}
  .who-contact{margin-top:8px;font-size:14px}
  .who-verdict{margin-top:12px;padding-top:12px;border-top:1px solid var(--line);font-size:14px;color:var(--ink)}
  .who-verdict b{color:var(--alarm)}
  .who-now{margin-top:10px;font-size:14px;color:var(--amber)}
  .law-code{font-weight:800;font-size:16px}
  .law-rule{margin-top:6px;font-size:14px;color:var(--ink)}
  .law-pen{margin-top:10px;font-size:14px}
  .law-pen span{display:inline-block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--alarm);font-weight:700;margin-right:6px}
  .law-also{margin-top:10px;font-size:12px;color:var(--mut)}
  .ask li{margin:8px 0}
  .actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 6px}
  .btn{display:inline-block;padding:11px 16px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none}
  .btn.x{background:var(--alarm);color:#fff}
  .btn.ghost{background:transparent;border:1px solid var(--line);color:var(--ink)}
  .fine{font-size:12px;color:var(--mut);margin-top:8px;line-height:1.5}
  .stamp{margin-top:26px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--mut)}
  /* Action rail */
  .action-rail{margin:24px 0 8px}
  .action-rail h2{margin-bottom:12px}
  .act-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
  .act-row:last-child{border-bottom:none}
  .act-row.act-coming{opacity:.45}
  .act-meta{display:flex;align-items:flex-start;gap:10px;flex:1;min-width:0}
  .act-icon{font-size:20px;flex:none;margin-top:1px}
  .act-title{font-weight:700;font-size:14px;color:var(--ink)}
  .act-desc{font-size:12px;color:var(--mut);margin-top:2px;line-height:1.4}
  .act-btn{display:inline-block;padding:8px 14px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;background:var(--amber);color:#000;border:none;cursor:pointer;white-space:nowrap;flex:none}
  .act-btn:disabled{opacity:.5;cursor:not-allowed}
  .act-btn-ghost{background:transparent;border:1px solid var(--line);color:var(--ink)}
  .act-btn-group{display:flex;gap:6px;flex:none}
  /* Momentum */
  .momentum{margin:16px 0 0;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:10px;font-size:13px;color:var(--ink)}
  .momentum.seed{color:var(--mut)}
  /* Ladder */
  .ladder{margin:16px 0 0;padding:12px 14px;border-radius:10px;font-size:14px;border-left:3px solid var(--amber)}
  .ladder.active{background:#1a1400;color:var(--amber)}
  .ladder.locked{background:var(--card);color:var(--mut);border-color:var(--line)}
  .ladder.done{background:#0d1a12;color:#3ddc84;border-color:#3ddc84}
</style></head><body><div class="wrap">
  <div class="mast"><a class="word" href="${esc(PUBLIC_ORIGIN)}/map">UN<b>IGNOR</b>ABLE</a><span class="tag">a public receipt</span></div>

  <div class="hero">
    <div class="kicker">${esc(issue.type)} &middot; ${esc(area)}</div>
    ${active
      ? `<div class="day-hero">Day ${dayN}</div>
    <div class="day-sub">ignored since ${esc(fmtDate(episodeStart))}</div>
    <p class="lead"><b>${fmtN(instReports)} reports</b> in this stretch alone. It is still open.</p>`
      : `<div class="dur">${fmtN(issue.n)}</div>
    <p class="lead">reports on the city's own record for this block${startTxt ? ` since ${esc(startTxt)}` : ''}.</p>`}

    ${severityLine ? `<div class="severity">${severityLine}</div>` : ''}

    <div class="indict">In ${esc(yrsTxt)}, the city was told <b>${fmtN(issue.n)} times</b> and closed the case <b>${fmtN(cn)} times</b>${nf ? `, including <b>${fmtN(nf)}</b> claiming nothing was there` : ''}. ${active ? 'It is still here.' : 'It kept coming back.'} Knowing is not fixing.</div>

    ${corrob > 0 ? `<div class="ugc"><div class="hdr">&#128065; <b>The block says it is still here.</b> ${fmtN(corrob)} ${corrob === 1 ? 'neighbor confirms' : 'neighbors confirm'}.</div>${latest && latest.text ? `<div class="q">"${esc(latest.text)}"${latest.photo ? ' (photo on file)' : ''}</div>` : ''}</div>` : ''}
  </div>

  <h2>What we are asking for</h2>
  <div class="card ask"><ul style="margin:0;padding-left:18px">
    ${askLines.map(l => `<li>${esc(l)}</li>`).join('')}
  </ul></div>

  <div class="action-rail">
    <h2>Act now</h2>
    ${ladderHtml}
    ${actionRailHtml}
    ${momentumHtml}
  </div>

  <details class="record"><summary>See the full city record &#8594;</summary>

    <div class="headline">${esc(issue.headline || '')}</div>
    <div class="grid">
      ${stat(fmtN(issue.n), 'times reported to 311', true)}
      ${stat(fmtN(cn), 'closed by the city')}
      ${stat(fmtN(nf), '"nothing found" closures', true)}
      ${stat(fmtN(rn), 'came back after closing', true)}
      ${stat(ard != null ? ard.toFixed(1) + 'd' : 'n/a', 'avg. before it returned')}
      ${stat(fmtN(issue.episode_count), 'separate flare-ups')}
    </div>
    <div class="spark"><div class="cap">every red band = a stretch the city was getting reports and closing them. ${esc(issue.first_seen)} to today.</div>${sparkline(issue)}</div>

    <h2>Who is accountable</h2>
    <div class="card">
      ${officialBlock}
      <div class="who-verdict">What the record shows: the city closed this <b>${fmtN(cn)} times</b>${nf ? `, including ${fmtN(nf)} of them as "nothing found"` : ''}. What changed on the block: <b>${active ? 'nothing, it is still here' : 'it kept coming back'}</b>. Responding agency on the tickets: ${esc(issue.agency || 'NYC')}.</div>
    </div>

    ${law ? `<h2>What the law says</h2>
    <div class="card law">
      <div class="law-code">${esc(law.code)}</div>
      <div class="law-rule">${esc(law.rule)}</div>
      <div class="law-pen"><span>Penalty</span> ${esc(law.penalty)}</div>
      <div class="law-also">${esc(law.also)} &middot; <a href="${esc(law.src)}">read the statute &#8594;</a></div>
    </div>` : ''}

    <h2>How we define this spot</h2>
    <div class="card disclose">The "Day ${dayN}" above is the count of days since the current unbroken run of reports began (the episode model), not the multi-year total. "This spot" is one ~1-block location in the city's data, whose coordinates round to about a block; nearby but distinct encampments are tracked as their own spots, never merged in to inflate a number. Every count is NYC's own 311 record for this location.</div>

    <div class="stamp">${stamp}<br>This page documents a <b>government's</b> response to a public-safety obstruction. It is not about, and does not identify, any individual experiencing homelessness. They are failed by this inaction, not the cause of it.</div>
  </details>

  ${T.posts && T.posts.length ? `<div class="ugc" style="margin-top:20px">
    <div class="hdr"><b>Neighbor reports</b></div>
    ${T.posts.map(p => `<div class="q">${esc(p.text || '')}${p.photo ? ' (photo on file)' : ''}<div style="font-size:11px;color:var(--mut);margin-top:4px">${esc(p.ts ? p.ts.slice(0,10) : '')}</div></div>`).join('')}
  </div>` : ''}

${actScript}
</div></body></html>`;
}

// Sitemap of the INDEXABLE receipts only — an Issue is indexable iff its district is verified
// (same gate as the page's robots meta), so a sitemap can never expose an unconfirmed name.
const SITEMAP = (() => {
  const urls = ISSUES
    .filter(isIndexable)
    .map(i => `  <url><loc>${PUBLIC_ORIGIN}/c?t=${encodeURIComponent(i.type)}&amp;id=${encodeURIComponent(i.id)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
})();
const ROBOTS = `User-agent: *\nAllow: /\nSitemap: ${PUBLIC_ORIGIN}/sitemap.xml\n`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');

  // Consolidation: sidewalk was absorbed into unignorable. Redirect the old host.
  if ((req.headers.host || '').startsWith('sidewalk')) {
    res.writeHead(301, { Location: 'https://unignorable.polyfeeds.dev' + req.url });
    return res.end();
  }

  if (u.pathname === '/api/trends') {
    return sendMaybeGzip(req, res, TRENDS, 'application/json');
  }

  // Address geocode — server-side proxy to OpenStreetMap Nominatim so the UA + referer policy and
  // a small LRU cache live here (Nominatim demands a descriptive UA, ~1 req/sec, no heavy use; a
  // shared tunnel IP would get rate-limited if every client called it directly). NYC viewbox-bounded.
  if (u.pathname === '/api/geocode') {
    const q = (u.searchParams.get('q') || '').trim();
    if (q.length < 3) return send(res, 200, '[]', 'application/json');
    const ckey = q.toLowerCase();
    const cached = geoCache.get(ckey);
    if (cached) { geoCache.delete(ckey); geoCache.set(ckey, cached); return send(res, 200, cached, 'application/json'); }
    try {
      const out = await geocode(q);
      geoCache.set(ckey, out);
      if (geoCache.size > 400) geoCache.delete(geoCache.keys().next().value); // LRU evict oldest
      return send(res, 200, out, 'application/json');
    } catch { return send(res, 200, '[]', 'application/json'); }
  }

  // Citizen-submitted proof photo, served by id. Filenames are random hex; path-traversal can't escape.
  if (u.pathname.startsWith('/photos/')) {
    const name = path.basename(u.pathname);
    const ext = name.split('.').pop();
    if (!MIME[ext]) return send(res, 404, 'not found', 'text/plain');
    try {
      const buf = fs.readFileSync(path.join(PHOTO_DIR, name));
      res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'public, max-age=31536000, immutable' });
      return res.end(buf);
    } catch { return send(res, 404, 'not found', 'text/plain'); }
  }

  // The map: city-sourced issues + status/pattern summary + live corroboration count.
  // Episodes (the timeline) are omitted here and lazy-loaded per card via /api/episodes.
  if (u.pathname === '/api/issues') {
    const c = issuesPayload();
    const ae = req.headers['accept-encoding'] || '';
    if (/\bgzip\b/.test(ae)) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip',
        'Vary': 'Accept-Encoding', 'Access-Control-Allow-Origin': '*' });
      return res.end(c.gz);
    }
    return send(res, 200, c.raw, 'application/json');
  }

  // Episode timeline for one issue (the sparkline) — lazy-loaded on card open.
  if (u.pathname === '/api/episodes') {
    const t = u.searchParams.get('type'), id = u.searchParams.get('id');
    const found = ISSUES.find(i => i.type === t && i.id === id);
    return send(res, 200, JSON.stringify(found ? found.episodes || [] : []), 'application/json');
  }

  // The thread: citizen commentary + the crowd's verdict for one issue.
  if (u.pathname === '/api/thread') {
    const t = u.searchParams.get('type'), id = u.searchParams.get('id');
    return send(res, 200, JSON.stringify(ugc.thread(key(t, id))), 'application/json');
  }

  // One-tap corroboration ("I see this often").
  if (u.pathname === '/api/seen' && req.method === 'POST') {
    if (rateLimited(req)) return send(res, 429, '{"ok":false,"error":"slow down"}', 'application/json');
    const { type, id } = await readBody(req);
    if (!type || !id) return send(res, 400, '{"ok":false}', 'application/json');
    const t = ugc.addPost(key(type, id), 'seen', null, 'still_here');
    return send(res, 200, JSON.stringify({ ok: true, ...t }), 'application/json');
  }

  // Full commentary ("Add what you see"): text + optional one-tap status + optional proof photo.
  if (u.pathname === '/api/post' && req.method === 'POST') {
    if (rateLimited(req)) return send(res, 429, '{"ok":false,"error":"slow down"}', 'application/json');
    const { type, id, text, status, photo } = await readBody(req);
    const file = photo ? savePhoto(photo) : null;
    if (!type || !id || (!text && !status && !file)) return send(res, 400, '{"ok":false}', 'application/json');
    const clean = (text || '').toString().slice(0, 500).trim();
    const st = ['still_here', 'worse', 'cleaned', 'gone'].includes(status) ? status : null;
    const t = ugc.addPost(key(type, id), 'comment', clean || null, st, file);
    return send(res, 200, JSON.stringify({ ok: true, ...t }), 'application/json');
  }

  // Action tracking — append-only momentum log of citizen actions.
  // Rate-limited (shared 12/5min/IP budget). Rejects unknown/coming/disabled action ids (400).
  // Corroborate logs here for momentum count AND to /api/seen for the corroboration verdict counter —
  // intentional double-count: two different purposes, two different tables. See ugc.js note.
  if (u.pathname === '/api/act' && req.method === 'POST') {
    if (rateLimited(req)) return send(res, 429, '{"ok":false,"error":"slow down"}', 'application/json');
    const body = await readBody(req);
    const { action_type, type, id } = body;
    const issueKey = key(type, id);
    // Validate issue exists.
    if (!ISSUE_BY_KEY.has(issueKey)) return send(res, 400, '{"ok":false,"error":"unknown issue"}', 'application/json');
    // Validate action_type is in the enabled-trackable allowlist (prevents phantom/coming types).
    if (!TRACKABLE_ACTIONS.has(action_type)) return send(res, 400, '{"ok":false,"error":"unknown action"}', 'application/json');
    const ip = clientIp(req);
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
    ugc.logAction(issueKey, action_type, ipHash);
    // Bust the issues payload cache so campaign counts are fresh (campaign key set unchanged,
    // but ugc countsAll may reflect a new seen if corroborate was called via /api/seen too).
    ISSUES_CACHE = null;
    const counts = ugc.actionCounts(issueKey);
    return send(res, 200, JSON.stringify({ ok: true, counts }), 'application/json');
  }

  // --- Review queue (Paul's personal gate before anything is public / filed to 311) ---
  if (u.pathname === '/api/review') {
    if (!authed(u)) return send(res, 401, '{"ok":false}', 'application/json');
    const items = ugc.pending().map(p => ({ ...p, issue: issueMeta(p.issue_key) }));
    return send(res, 200, JSON.stringify({ ok: true, count: items.length, items }), 'application/json');
  }
  if (u.pathname === '/api/review/decide' && req.method === 'POST') {
    if (!authed(u)) return send(res, 401, '{"ok":false}', 'application/json');
    const { id, action } = await readBody(req);
    if (!['approve', 'reject'].includes(action)) return send(res, 400, '{"ok":false}', 'application/json');
    const row = ugc.decide(id, action);
    if (row && action === 'reject' && row.photo) { try { fs.unlinkSync(path.join(PHOTO_DIR, row.photo)); } catch {} }
    return send(res, 200, JSON.stringify({ ok: !!row, count: ugc.pendingCount() }), 'application/json');
  }
  if (u.pathname === '/review') {
    if (!authed(u)) return send(res, 401, 'unauthorized', 'text/plain');
    return send(res, 200, fs.readFileSync(path.join(DIR, 'review.html')), 'text/html; charset=utf-8');
  }

  if (u.pathname === '/robots.txt') return send(res, 200, ROBOTS, 'text/plain');
  if (u.pathname === '/sitemap.xml') return send(res, 200, SITEMAP, 'application/xml');

  // The CAMPAIGN PAGE: /i, /issue, /c, /campaign all render the same surface.
  if (u.pathname === '/i' || u.pathname === '/issue' || u.pathname === '/c' || u.pathname === '/campaign') {
    const t = u.searchParams.get('t') || u.searchParams.get('type');
    const id = u.searchParams.get('id');
    const issue = ISSUES.find(i => i.type === t && i.id === id);
    if (!issue) return send(res, 404, 'No such record.', 'text/plain');
    return send(res, 200, renderCampaign(issue), 'text/html; charset=utf-8');
  }

  // The landing ("The Record") and the live map are ONE document: index.html decides what to
  // render from location (hash / query). /map is the map-first entry (deep-links target it);
  // / is the shame-board landing. Same file -> one /api/issues fetch, every map fn reused.
  if (u.pathname === '/' || u.pathname === '/index.html' || u.pathname === '/map') {
    return send(res, 200, fs.readFileSync(path.join(DIR, 'index.html')), 'text/html; charset=utf-8');
  }

  send(res, 404, 'not found', 'text/plain');
});

server.listen(PORT, () => {
  console.log(`unignorable on :${PORT} — ${ISSUES.length} issues`);
  console.log(`review queue -> /review?k=${REVIEW_KEY}`);
});
