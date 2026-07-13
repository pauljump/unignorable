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
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(DIR, 'data'));
const PORT = process.env.PORT || 8000;
const ISSUES = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'issues.json'), 'utf8'));
const TRENDS = fs.readFileSync(path.join(DATA_DIR, 'trends.json'));
// Disparity engine output (the city's own dismissal-rate gap between districts). Degrades to empty
// if the build hasn't produced it yet — the /api/disparity route returns {} and the view hides.
let DISPARITY = Buffer.from('{}');
try { DISPARITY = fs.readFileSync(path.join(DATA_DIR, 'disparity.json')); } catch {}

// Accountable-officials roster (council district -> member + contact + X handle, Mayor's CAU).
// Optional: the receipt page degrades to "district N + look-up link" if the file isn't present yet.
let OFFICIALS = { council: {}, cau: null, borough_presidents: {} };
try { OFFICIALS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'officials.json'), 'utf8')); } catch {}

// Community boards data (for cb_agenda action template). Degrades gracefully if missing.
let COMMUNITY_BOARDS = {};
try { COMMUNITY_BOARDS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'community_boards.json'), 'utf8')); } catch {}

// Press tip lines (for press_tip action template). Degrades gracefully if missing.
let PRESS_TIPS = {};
try { PRESS_TIPS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'press_tips.json'), 'utf8')); } catch {}

let CAMPAIGN_CONTEXT = {}, CAMPAIGN_EVIDENCE = {};
try { CAMPAIGN_CONTEXT = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'campaign_context.json'), 'utf8')); } catch {}
try { CAMPAIGN_EVIDENCE = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'campaign_evidence.json'), 'utf8')); } catch {}

// Action type registry — DATA, not code. Actions are addable as a row with no server rebuild.
let ACTION_TYPES = [];
try { ACTION_TYPES = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'action_types.json'), 'utf8')); } catch {}
// Allowlist: enabled, non-coming action ids (instant|prepared|external).
const TRACKABLE_ACTIONS = new Set(
  ACTION_TYPES.filter(a => a.enabled && a.kind !== 'coming').map(a => a.id)
);

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || 'https://unignorable.polyfeeds.dev';
const CANARY_TYPE = 'Encampment';
const CANARY_ID = '40.736,-73.983';
const CANARY_URL = `/c?t=${encodeURIComponent(CANARY_TYPE)}&id=${encodeURIComponent(CANARY_ID)}`;
const PULSE_BEACON = `<script>(function(){if(location.hostname==="localhost"||location.hostname==="127.0.0.1")return;var I="https://pulse.polyfeeds.dev/api/ingest";function s(e,x){try{var b=JSON.stringify(Object.assign({event:e,path:location.pathname,referrer:document.referrer||undefined,screen:innerWidth+"x"+innerHeight},x||{}));if(navigator.sendBeacon){navigator.sendBeacon(I,new Blob([b],{type:"text/plain"}))}else{fetch(I,{method:"POST",headers:{"Content-Type":"text/plain"},keepalive:true,body:b})}}catch(e){}}window.pulse=s;s("page_view");var t=Date.now();function d(){s("page_dwell",{dwellMs:Date.now()-t})}addEventListener("pagehide",d);document.addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden")d()})})();</script>`;

// Photo store — the proof layer 311 open data structurally can't have. Bytes on disk, served by id.
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
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
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=()',
};
const send = (res, code, body, type, extra = {}) => {
  res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
};
// Gzip a response body when the client accepts it, falling back to identity otherwise.
// The 6.26 MB /api/issues blob is render-blocking; gzip cuts it ~89% with zero new deps.
const sendMaybeGzip = (req, res, body, type) => {
  const ae = req.headers['accept-encoding'] || '';
  if (/\bgzip\b/.test(ae)) {
    const gz = Buffer.isBuffer(body) && body._gz ? body._gz : zlib.gzipSync(body);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Encoding': 'gzip',
      'Vary': 'Accept-Encoding' });
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
const REPORT_PRESSURE = new Map();
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
    const byReports = byType[type].slice().sort((a, b) => (Number(b.n) || 0) - (Number(a.n) || 0));
    byReports.forEach((iss, idx) => REPORT_PRESSURE.set(key(iss.type, iss.id), {
      rank: idx + 1,
      total: byReports.length,
      percentile: Math.round(100 * (byReports.length - idx) / byReports.length),
    }));
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
  const out = ISSUES.map(({ episodes, headline_kind, ...i }) =>
    ({ ...i, seen: counts[key(i.type, i.id)] || 0, campaign: campaignKeys.has(key(i.type, i.id)) }));
  const raw = Buffer.from(JSON.stringify(out));
  ISSUES_CACHE = { sig, raw, gz: zlib.gzipSync(raw) };
  return ISSUES_CACHE;
}
const BODY_MAX = 3_000_000;
const readBody = (req) => new Promise((resolve, reject) => {
  let b = '', size = 0;
  req.on('data', c => {
    size += c.length;
    if (size > BODY_MAX) {
      reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
      return;
    }
    b += c;
  });
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { reject(Object.assign(new Error('invalid JSON'), { statusCode: 400 })); } });
  req.on('error', reject);
});

// Review key — Paul's personal gate. Stable secret in data/admin-key (gitignored), generated once.
const KEY_FILE = path.join(DATA_DIR, 'admin-key');
let REVIEW_KEY = process.env.REVIEW_KEY || '';
if (!REVIEW_KEY) {
  try { REVIEW_KEY = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch {}
  if (!REVIEW_KEY) { REVIEW_KEY = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(KEY_FILE, REVIEW_KEY); }
}
function reviewToken(req, u) {
  const query = u.searchParams.get('k');
  if (query) return query;
  const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('unig_review='));
  return cookie ? decodeURIComponent(cookie.slice('unig_review='.length)) : '';
}
function authed(req, u) {
  const token = reviewToken(req, u);
  if (!REVIEW_KEY || token.length !== REVIEW_KEY.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(REVIEW_KEY));
}

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
const formatEstimatedCost = (x) => {
  const n = Number(x) || 0;
  if (n >= 1000) return `~$${n >= 10000 ? Math.round(n / 1000) : (n / 1000).toFixed(1).replace('.0', '')}k`;
  return `~$${Math.round(n)}`;
};
const formatResponseCostRange = basis => basis
  ? `${formatEstimatedCost(basis.low)}-${formatEstimatedCost(basis.planning).replace(/^~/, '')}`
  : 'n/a';
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();
const daysSince = (iso) => {
  const t = Date.parse((iso || '') + 'T00:00:00Z');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};
const daysBetween = (start, end) => {
  const a = Date.parse((start || '') + 'T00:00:00Z');
  const b = Date.parse((end || '') + 'T00:00:00Z');
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.floor((b - a) / 86400000)) : 0;
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
const contextFor = issue => CAMPAIGN_CONTEXT[key(issue.type, issue.id)] || null;
const evidenceFor = issue => CAMPAIGN_EVIDENCE[key(issue.type, issue.id)] || null;
const displayLocation = issue => (contextFor(issue) && contextFor(issue).display_location)
  || titleCase(issue.addr) || 'this location';

// THE ASK block per complaint type. Service-first, no criminal claim for non-structure types.
function askForType(issueOrType) {
  const issue = typeof issueOrType === 'string' ? null : issueOrType;
  const type = typeof issueOrType === 'string' ? issueOrType : issueOrType.type;
  if (type === 'Encampment') {
    const proximity = issue && issue.sensitive_site_summary;
    const schoolAsk = proximity && proximity.school_count > 0
      ? `Treat the school approach as urgent. The NYC Facilities Database places ${fmtN(proximity.school_count)} K-12 school${proximity.school_count === 1 ? '' : 's'} within ${fmtN(proximity.radius_ft)} feet, the nearest about ${fmtN(proximity.nearest_school_ft)} feet away. Children, families, and staff should not have to navigate a repeatedly confirmed sidewalk encampment while agencies cycle through closures.`
      : null;
    return [
      'Clear the sidewalk obstruction. NYC Admin Code §16-122 and §19-136 give the city clear authority to act on persistent sidewalk obstructions.',
      schoolAsk,
      'Connect these neighbors to services. File this location as an outreach request to DHS so the people here are offered shelter and help. Clearing without serving just moves the problem.',
      'Require a durable, written response plan: named agency ownership, repeated outreach, a clear pedestrian route, and a dated follow-up inspection. Closing a ticket is not the same as fixing the problem.',
    ].filter(Boolean);
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
function buildEmailOfficialUrl(issue, campaign, trackedReceiptUrl) {
  const m = councilFor(issue.council);
  const verified = !!(m && m.member && m.verified);
  const toEmail = verified ? m.email : CAU_EMAIL;
  const toName = verified ? m.member : 'Council Member';
  const addr = displayLocation(issue);

  // Live numbers from the issue record.
  const eps = Array.isArray(issue.episodes) ? issue.episodes : [];
  const curEp = eps.length ? eps[eps.length - 1] : null;
  const epStart = curEp ? curEp[0] : (issue.first_seen || '');
  const epStartFmt = fmtDate(epStart);
  const dayN = curEp ? daysBetween(curEp[0], curEp[1]) : 0;
  const cn = Number(issue.closed_n) || 0;
  const nf = Number(issue.nothing_found) || 0;
  const n = Number(issue.n) || 0;

  const receiptUrl = trackedReceiptUrl || `${PUBLIC_ORIGIN}/c?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`;
  const evidence = evidenceFor(issue);
  const state = evidence && evidence.state_model;
  const currentState = state && state.current;
  const askLines = askForType(issue);

  const subject = `[Constituent Request] Repeated ${issue.type} reports ${addr}`;

  const body = [
    `Dear ${toName},`,
    '',
    `I am writing as a constituent about repeated ${issue.type.toLowerCase()} reports ${addr}. ${currentState
      ? `The address-specific evidence model supports continuous occupation since ${fmtDate(currentState.supported_from)} with a ${state.continuity_confidence_score}/100 evidence-confidence score.`
      : `NYC 311 reporting activity for this approximate block has continued in the current reporting episode since ${epStartFmt}.`} This is an inference from report frequency and agency observations, not proof that one unchanged tent was present throughout.`,
    '',
    `The city\'s own 311 record shows:`,
    `- ${n} service requests in the approximate-block record`,
    evidence ? `- ${evidence.address_current_episode_requests} requests in the current reporting episode specifically naming the configured campaign address, across ${evidence.address_current_episode_report_days} distinct reporting days` : '',
    currentState ? `- ${currentState.positive_observations} positive agency observations and ${currentState.outreach_contacts} outreach contacts in the current supported interval` : '',
    state && state.response_labor ? `- ${formatResponseCostRange(state.response_labor)} estimated response-labor range across ${state.response_labor.response_units} deduplicated response-days/classes; this excludes cleanup, vehicles, supervision, shelter, and medical costs` : '',
    state && state.interruptions.length ? `- The record shows a ${state.interruptions.at(-1).support_gap_days}-day support-evidence gap before ${fmtDate(state.interruptions.at(-1).return_supported_on)}, ${state.interruptions.at(-1).inference === 'likely_interruption' ? 'supporting a likely inactive interval and later return' : 'consistent with a possible interruption and return'}, but not a documented cleanup` : '',
    `- ${cn} times the city marked the case "resolved"`,
    nf ? `- ${nf} of those closures stated "nothing found"` : '',
    '',
    `The reporting record is currently active according to the published methodology.`,
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
  const addr = displayLocation(issue);
  const receiptUrl = `${PUBLIC_ORIGIN}/c?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`;
  const cbEpisodes = Array.isArray(issue.episodes) ? issue.episodes : [];
  const cbEpisode = cbEpisodes.length ? cbEpisodes[cbEpisodes.length - 1] : null;
  const dayN = cbEpisode ? daysBetween(cbEpisode[0], cbEpisode[1]) : 0;

  const subject = `Agenda Item Request: repeated ${issue.type} reports ${addr}`;
  const body = [
    `Dear District Manager,`,
    '',
    `I am writing to request that the following matter be placed on the agenda for ${boardName}\'s next full board or relevant committee meeting.`,
    '',
    `Location: ${addr}`,
    `Issue type: ${issue.type}`,
    `Current 311 reporting episode: ${dayN} days since its first request`,
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
  const addr = displayLocation(issue);
  const receiptUrl = `${PUBLIC_ORIGIN}/c?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`;
  const pressEpisodes = Array.isArray(issue.episodes) ? issue.episodes : [];
  const pressEpisode = pressEpisodes.length ? pressEpisodes[pressEpisodes.length - 1] : null;
  const dayN = pressEpisode ? daysBetween(pressEpisode[0], pressEpisode[1]) : 0;

  const subject = `Tip: repeated ${issue.type} reports ${addr}`;
  const body = [
    `Hi ${outletName} team,`,
    '',
    `I wanted to flag a situation that may be worth covering.`,
    '',
    `NYC 311 reporting activity for an approximate block ${addr} has continued in the current reporting episode for ${dayN} days. This measures requests, not the uninterrupted presence of one physical object. The city has logged ${fmtN(issue.n)} service requests for the block-level record and closed ${fmtN(Number(issue.closed_n) || 0)} of them.`,
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
function buildShareUrl(issue, trackedShareUrl) {
  const m = councilFor(issue.council);
  const tag = (m && m.x) ? `@${m.x.replace(/^@/, '')} ` : '@NYCCouncil ';
  const addr = displayLocation(issue);
  const active = issue.status === 'active';
  const eps = Array.isArray(issue.episodes) ? issue.episodes : [];
  const curEp = eps.length ? eps[eps.length - 1] : null;
  const epStart = curEp ? curEp[0] : issue.first_seen;
  const episodeReports = curEp ? Number(curEp[2]) || 0 : Number(issue.n) || 0;
  const cn = Number(issue.closed_n) || 0;
  const n = Number(issue.n) || 0;
  const evidence = evidenceFor(issue);
  const state = evidence && evidence.state_model;
  const currentState = state && state.current;

  const shareUrl = trackedShareUrl || `${PUBLIC_ORIGIN}/c?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`;
  const tweet = `${tag}`
    + `${addr}: NYC 311 logged ${fmtN(n)} service requests for the approximate block`
    + (currentState ? `. Address-level evidence supports continuous occupation since ${fmtDate(currentState.supported_from)} (${state.continuity_confidence_score}/100 confidence index). `
      : active ? `, including ${fmtN(episodeReports)} in the current reporting episode. ` : '. ')
    + `The city closed ${fmtN(cn)} requests. `
    + `Clear the sidewalk AND connect these neighbors to services. The record:`;
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(shareUrl)}`;
  return { tweetUrl, shareUrl };
}

// ---- CAMPAIGN PAGE (superset of the receipt) ----
// Renders at /i, /issue, /c, /campaign. Identical output.
// Layout: Day-N hero -> severity line -> THE ASK -> evidence block -> action rail -> momentum -> UGC thread.
function renderCampaign(issue) {
  const issueKey = key(issue.type, issue.id);
  const context = contextFor(issue);
  const evidence = evidenceFor(issue);
  const state = evidence && evidence.state_model;
  const currentState = state && state.current;
  const latestInterruption = state && state.interruptions && state.interruptions.length
    ? state.interruptions[state.interruptions.length - 1] : null;
  const addr = displayLocation(issue);
  const boro = titleCase(issue.borough);
  const area = boro ? `${addr}, ${boro}` : addr;
  const nf = Number(issue.nothing_found) || 0;
  const cn = Number(issue.closed_n) || 0;
  const rn = Number(issue.returned_n) || 0;
  const ard = (issue.avg_return_days != null && Number.isFinite(issue.avg_return_days)) ? issue.avg_return_days : null;
  const m = councilFor(issue.council);
  const verified = !!(m && m.member && m.verified);
  const law = LAW[issue.type];
  const cau = OFFICIALS.cau;
  const active = issue.status === 'active';
  const yrsTxt = issue.first_seen ? `since ${monthYear(issue.first_seen)}` : 'in the public record';

  // Campaign permalink uses /c.
  const shareUrl = `${PUBLIC_ORIGIN}/c?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`;

  // Current episode start — computed LIVE at render (not the stale current_days field).
  const eps = Array.isArray(issue.episodes) ? issue.episodes : [];
  const curEp = eps.length ? eps[eps.length - 1] : null;
  const episodeStart = curEp ? curEp[0] : issue.first_seen;
  // Episode duration ends at the latest city request; it never silently extends to today.
  const dayN = curEp ? daysBetween(curEp[0], curEp[1]) : 0;
  const instReports = curEp ? curEp[2] : issue.n;
  const startTxt = monthYear(episodeStart);
  const observation = context && context.observation;
  const sensitiveSites = Array.isArray(issue.sensitive_sites) ? issue.sensitive_sites : [];
  const schoolSites = sensitiveSites.filter(site => site.category === 'school');
  const childcareSites = sensitiveSites.filter(site => site.category === 'childcare');
  const sensitiveSummary = issue.sensitive_site_summary || null;
  const pressure = REPORT_PRESSURE.get(issueKey);
  const reportPressure = pressure ? pressure.percentile : null;

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
  let severityLine = '';
  if (active && pressure) {
    severityLine = `#${pressure.rank} of ${pressure.total} active ${esc(issue.type)} approximate blocks citywide by service-request volume`;
  }

  // Title/OG leads with literal request volume. Reporting continuity is not physical continuity.
  const ogTitle = currentState
    ? `Occupation supported since ${fmtDate(currentState.supported_from)} ${addr}.`
    : active
    ? `${fmtN(instReports)} NYC service requests in the current reporting episode ${addr}.`
    : `${area}: ${fmtN(issue.n)} reports on the city's own record.`;
  const ogDesc = `${fmtN(issue.n)} NYC 311 service requests ${yrsTxt}; the city closed ${fmtN(cn)} requests`
    + (active ? `. The public record remains active.` : '.')
    + (verified ? ` Accountable: Council Member ${m.member}.` : '');

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
          ? 'The record remains active on their watch and within their power to move DHS, Sanitation, and NYPD on it now.'
          : 'The record is theirs to answer for.'}</div>`;
  } else {
    const dn = m && m.district ? m.district : (issue.council || '?');
    officialBlock = `<div class="who-name">Council District ${esc(dn)}</div>`
      + `<div class="who-contact"><a href="https://council.nyc.gov/districts/">Find &amp; name the member &#8594;</a></div>`;
  }

  const stamp = `Built from New York City's own 311 open data (dataset erm2-nwe9)`
    + (issue.last_seen ? `, current through ${esc(issue.last_seen)}` : '') + '.';

  // THE ASK lines for this issue type.
  const askLines = askForType(issue);

  // Action rail — iterate ACTION_TYPES, build controls.
  // For prepared actions: build mailto/intent href; onclick logs to /api/act then proceeds.
  const actScript = `<script>
function logAct(actionType){
  fetch('/api/act',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action_type:actionType,type:${JSON.stringify(issue.type)},id:${JSON.stringify(issue.id)}})
  }).catch(()=>{});
}
function confirmIssue(button){
  button.disabled=true;
  fetch('/api/seen',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({type:${JSON.stringify(issue.type)},id:${JSON.stringify(issue.id)}})
  }).then(function(response){
    if(!response.ok) throw new Error('confirmation failed');
    button.textContent='Confirmed';
    logAct('corroborate');
  }).catch(function(){
    button.disabled=false;
    button.textContent='Try again';
  });
}
function copyLink(url){
  navigator.clipboard && navigator.clipboard.writeText(url).then(()=>{
    var el=document.getElementById('copy-link-btn');
    if(el){var orig=el.textContent;el.textContent='Copied!';setTimeout(()=>{el.textContent=orig;},1500);}
  }).catch(()=>{ window.prompt('Copy this link:',url); });
}
async function prepareOfficialAction(button,actionType){
  var original=button.textContent;
  button.disabled=true;button.textContent='Preparing...';
  try{
    var response=await fetch('/api/action/prepare',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action_type:actionType,type:${JSON.stringify(issue.type)},id:${JSON.stringify(issue.id)}})});
    var out=await response.json();if(!response.ok)throw new Error(out.error||'Could not prepare action');
    if(window.pulse)window.pulse('official_action_prepared',{actionType:actionType,receipt:out.receipt});
    var receipt=document.getElementById('action-receipt-link');
    if(receipt){receipt.href=out.receiptUrl;receipt.hidden=false;}
    location.href=out.href;
  }catch(error){button.disabled=false;button.textContent=original;}
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
        <button class="act-btn" onclick="confirmIssue(this)">Confirm</button>
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
      actionRailHtml += `<div class="act-row">
        <div class="act-meta">${iconHtml}<div><div class="act-title">${esc(at.title)}</div><div class="act-desc">${esc(at.desc)}</div></div></div>
        <button class="act-btn" onclick="prepareOfficialAction(this,'email_official')">Email</button>
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
      const { shareUrl: sUrl } = buildShareUrl(issue);
      actionRailHtml += `<div class="act-row">
        <div class="act-meta">${iconHtml}<div><div class="act-title">${esc(at.title)}</div><div class="act-desc">${esc(at.desc)}</div></div></div>
        <div class="act-btn-group">
          <button class="act-btn" onclick="prepareOfficialAction(this,'share_card')">Post to X</button>
          <button class="act-btn act-btn-ghost" id="copy-link-btn" data-url="${esc(sUrl)}" onclick="logAct('share_card');copyLink(this.dataset.url)">Copy link</button>
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
  actionRailHtml += `<div class="action-receipt"><a id="action-receipt-link" hidden target="_blank" rel="noopener">View permanent action receipt</a></div>`;

  // Momentum feed — from actionCounts.thisWeek.
  const wkTotal = actionCts.thisWeek.total || 0;
  const wkByType = actionCts.thisWeek.byType || {};
  let momentumHtml;
  if (wkTotal > 0) {
    const parts = [];
    if (wkByType.email_official_prepared) parts.push(`${wkByType.email_official_prepared} official email draft${wkByType.email_official_prepared !== 1 ? 's' : ''} prepared`);
    if (wkByType.email_official) parts.push(`${wkByType.email_official} official email${wkByType.email_official !== 1 ? 's' : ''} sender-confirmed`);
    if (wkByType.share_card_prepared) parts.push(`${wkByType.share_card_prepared} X post${wkByType.share_card_prepared !== 1 ? 's' : ''} prepared`);
    if (wkByType.share_card) parts.push(`${wkByType.share_card} X post${wkByType.share_card !== 1 ? 's' : ''} sender-confirmed`);
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
      const recurrenceNote = ladder.recurrence ? ' <b>A new reporting episode began after a quiet interval. Re-engage the official with the updated record.</b>' : '';
      ladderHtml = `<div class="ladder active">Next action: ${esc(rung.label)}${recurrenceNote}</div>`;
    }
  }

  const stat = (big, label, alarm) =>
    `<div class="stat"><div class="big ${alarm ? 'alarm' : ''}">${big}</div><div class="lbl">${label}</div></div>`;
  const publicHeadline = currentState
    ? `Address-level evidence supports continuous occupation since ${fmtDate(currentState.supported_from)}.`
    : issue.headline_kind === 'persistence'
    ? `311 reporting activity has continued in this episode since ${fmtDate(episodeStart)}.`
    : issue.headline_kind === 'recurrence'
      ? `${fmtN(issue.episode_count)} reporting episodes are separated by material quiet intervals.`
      : (issue.headline || '');
  const observationHtml = observation
    ? `<div class="observation"><b>Dated neighbor observation:</b> the ${esc(observation.attribution || 'campaign organizer')} reports seeing the current tent for at least ${fmtN(observation.minimum_months)} months as of ${esc(fmtDate(observation.as_of))}. This is a firsthand minimum, not a claim that it is the same object as earlier 311 records.</div>`
    : '';
  const evidenceHtml = evidence
    ? `<div class="evidence"><b>Address-specific record:</b> ${fmtN(evidence.address_requests)} requests match the configured address near 246 East 20th Street across ${fmtN(evidence.address_report_days)} reporting days from ${esc(fmtDate(evidence.address_first_report))} through ${esc(fmtDate(evidence.address_latest_report))}. The wider approximate-block cell contains ${fmtN(evidence.approximate_block_requests)} requests.</div>`
    : '';
  const stateHtml = currentState
    ? `<section class="state"><h2>Occupation evidence</h2>
      <div class="state-verdict"><div><b>${state.continuity_confidence_score}/100</b><span>continuity confidence</span></div><p>Agency observations, outreach contacts, and report frequency support continuous occupation from <b>${esc(fmtDate(currentState.supported_from))}</b> through the latest supporting city record on <b>${esc(fmtDate(currentState.supported_through))}</b>.</p></div>
      <div class="state-facts"><span><b>${fmtN(currentState.support_days)}</b> support days</span><span><b>${fmtN(currentState.positive_observations)}</b> positive observations</span><span><b>${fmtN(currentState.outreach_contacts)}</b> outreach contacts</span><span><b>${fmtN(state.cadence_window_days)}d</b> continuity window</span></div>
      ${latestInterruption ? `<div class="interruption"><b>${latestInterruption.inference === 'likely_interruption' ? 'Likely interruption; return supported' : 'Possible interruption and return'}:</b> supporting evidence stops after ${esc(fmtDate(latestInterruption.last_support_before))} and resumes ${esc(fmtDate(latestInterruption.next_support))}, a ${fmtN(latestInterruption.support_gap_days)}-day gap${latestInterruption.negative_only_days ? ` containing ${fmtN(latestInterruption.negative_only_days)} negative-only inspection${latestInterruption.negative_only_days === 1 ? '' : 's'}` : ''}. This supports a period of likely inactivity followed by renewed occupation, but does not document a cleanup.</div>` : ''}
      <p class="fine">This score is an evidence index, not a probability. It does not prove one unchanged tent or a documented cleanup.</p>
    </section>` : '';
  const costBasis = state && state.response_labor ? state.response_labor : issue.response_labor;
  const costHtml = costBasis && costBasis.response_units > 0
    ? `<section class="cost"><h2>What repeated response has cost</h2>
      <div class="cost-range">${esc(formatResponseCostRange(costBasis))}</div>
      <p class="cost-lead">Estimated response labor across ${fmtN(costBasis.response_units)} deduplicated response-days and response classes. The lower bound assumes one worker for 30 minutes; the planning estimate assumes two workers for one hour.</p>
      <div class="cost-equation">${fmtN(costBasis.response_units)} units &times; $${costBasis.reference_hourly.toFixed(2)}/hour &times; 0.5-2 worker-hours</div>
      <p class="fine">Not an audited bill. This deliberately excludes 311 intake, vehicles, supervision, contractor overhead, cleanup, shelter, and medical care because the location record does not support assigning those costs. Wage reference: <a href="${esc(costBasis.source)}" target="_blank" rel="noopener">NYPD published starting salary</a>.</p>
    </section>` : '';
  const impactHtml = sensitiveSummary && schoolSites.length
    ? `<section class="impact"><h2>${fmtN(sensitiveSummary.school_count)} schools within ${fmtN(sensitiveSummary.radius_ft)} feet</h2>
      <div class="impact-callout">It is unacceptable for the city to leave a repeatedly confirmed sidewalk encampment on a daily route used by children, families, and school staff, then treat ticket closure as resolution. This is a failure of both pedestrian access and human services.</div>
      <div class="scoreline"><div><b>${fmtN(sensitiveSummary.school_count)}</b><span>K-12 schools within ${fmtN(sensitiveSummary.radius_ft)} ft</span></div><div><b>${fmtN(sensitiveSummary.nearest_school_ft)} ft</b><span>nearest recorded school</span></div><div><b>${reportPressure}</b><span>report-volume percentile</span></div></div>
      <p class="fine">These are literal straight-line distances from the approximate issue location, not a claim that any person caused harm. Counts come from the citywide NYC Planning Facilities Database and are computed the same way for every issue.</p>
      <div class="places">${schoolSites.map(place => `<div><b>${esc(place.name)}</b> &middot; ${esc(place.address || 'address unavailable')} &middot; ${fmtN(place.distance_ft)} ft</div>`).join('')}${childcareSites.length ? `<div><b>Also nearby:</b> ${fmtN(sensitiveSummary.childcare_count)} childcare/pre-K facilit${sensitiveSummary.childcare_count === 1 ? 'y' : 'ies'} within ${fmtN(sensitiveSummary.radius_ft)} feet.</div>` : ''}</div>
      <p class="fine"><a href="${esc(sensitiveSummary.source)}" target="_blank" rel="noopener">NYC Planning Facilities Database source</a></p>
    </section>` : '';

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
  .action-receipt{padding-top:10px;font-size:12px}
  .observation,.evidence{margin:12px 0;padding:12px 14px;border-left:3px solid var(--amber);background:var(--card);font-size:14px}
  .state{margin:22px 0}.state h2{margin-top:0}.state-verdict{display:grid;grid-template-columns:120px 1fr;gap:16px;align-items:center;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:14px 0}.state-verdict>div{text-align:center}.state-verdict>div b{display:block;color:var(--amber);font-size:28px}.state-verdict>div span{display:block;color:var(--mut);font-size:11px}.state-verdict p{margin:0;font-size:14px}.state-facts{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);margin-top:1px}.state-facts span{background:var(--bg);padding:10px 6px;text-align:center;color:var(--mut);font-size:11px}.state-facts b{display:block;color:var(--ink);font-size:17px}.interruption{margin-top:14px;padding:12px 14px;border-left:3px solid var(--mut);background:var(--card);font-size:13px;color:var(--mut)}.interruption b{color:var(--ink)}
  .cost{padding:22px 0;border-top:1px solid var(--line)}.cost h2{margin-top:0}.cost-range{font-size:42px;line-height:1;font-weight:800;color:var(--amber)}.cost-lead{font-size:15px;max-width:600px}.cost-equation{display:inline-block;padding:7px 9px;background:var(--card);border:1px solid var(--line);font:12px ui-monospace,SFMono-Regular,Menlo,monospace}.impact-callout{font-size:18px;line-height:1.45;font-weight:700;border-left:3px solid var(--alarm);padding:4px 0 4px 14px;margin:12px 0 18px}
  .scoreline{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .scoreline>div{padding:14px 8px;text-align:center;border-right:1px solid var(--line)}
  .scoreline>div:last-child{border-right:0}.scoreline b{display:block;font-size:25px;color:var(--amber)}.scoreline span{font-size:11px;color:var(--mut)}
  .places{font-size:13px;line-height:1.55}.places>div{padding:8px 0;border-bottom:1px solid var(--line)}
  /* Momentum */
  .momentum{margin:16px 0 0;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:10px;font-size:13px;color:var(--ink)}
  .momentum.seed{color:var(--mut)}
  /* Ladder */
  .ladder{margin:16px 0 0;padding:12px 14px;border-radius:10px;font-size:14px;border-left:3px solid var(--amber)}
  .ladder.active{background:#1a1400;color:var(--amber)}
  .ladder.locked{background:var(--card);color:var(--mut);border-color:var(--line)}
  .ladder.done{background:#0d1a12;color:#3ddc84;border-color:#3ddc84}
  .start-band{margin-top:30px;padding:24px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .start-band h2{margin:0 0 6px;color:var(--ink);font-size:20px;letter-spacing:0;text-transform:none}
  .start-band p{margin:0 0 15px;color:var(--mut);font-size:14px;max-width:520px}
  .start-link{display:inline-block;background:var(--amber);color:#000;text-decoration:none;border-radius:6px;padding:10px 15px;font-weight:800;font-size:14px}
  @media(max-width:520px){.state-verdict{grid-template-columns:1fr}.state-verdict>div{text-align:left}.state-facts{grid-template-columns:repeat(2,1fr)}}
</style></head><body><div class="wrap">
  <div class="mast"><a class="word" href="${esc(PUBLIC_ORIGIN)}/map">UN<b>IGNOR</b>ABLE</a><span class="tag">a public receipt</span></div>

  <div class="hero">
    <div class="kicker">${esc(issue.type)} &middot; ${esc(area)}</div>
    ${currentState
      ? `<div class="day-hero">${fmtN(currentState.reports)}</div>
    <div class="day-sub">address-specific reports in the supported interval since ${esc(fmtDate(currentState.supported_from))}</div>
    <p class="lead">The address-level record supports <b>continuous occupation</b>. Confidence: ${fmtN(state.continuity_confidence_score)}/100, based on observations, outreach, and reporting cadence.</p>`
      : active
      ? `<div class="day-hero">${fmtN(instReports)}</div>
    <div class="day-sub">service requests in the current reporting episode since ${esc(fmtDate(episodeStart))}</div>
    <p class="lead">This is continuous <b>reporting activity</b>, not proof that one tent remained for ${fmtN(dayN)} days.</p>`
      : `<div class="dur">${fmtN(issue.n)}</div>
    <p class="lead">reports on the city's own record for this block${startTxt ? ` since ${esc(startTxt)}` : ''}.</p>`}

    ${severityLine ? `<div class="severity">${severityLine}</div>` : ''}

    ${observationHtml}
    ${evidenceHtml}
    ${stateHtml}

    <div class="indict">${esc(yrsTxt.charAt(0).toUpperCase() + yrsTxt.slice(1))}, NYC 311 logged <b>${fmtN(issue.n)} service requests</b> in this approximate-block record and the city closed <b>${fmtN(cn)}</b>${nf ? `, including <b>${fmtN(nf)}</b> with a "nothing found" response` : ''}. ${active ? 'The reporting record remains active.' : 'The same block kept being reported again.'} Knowing is not fixing.</div>

    ${corrob > 0 ? `<div class="ugc"><div class="hdr">&#128065; <b>The block says it is still here.</b> ${fmtN(corrob)} ${corrob === 1 ? 'neighbor confirms' : 'neighbors confirm'}.</div>${latest && latest.text ? `<div class="q">"${esc(latest.text)}"${latest.photo ? ' (photo on file)' : ''}</div>` : ''}</div>` : ''}
  </div>

  ${costHtml}
  ${impactHtml}

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

    <div class="headline">${esc(publicHeadline)}</div>
    <div class="grid">
      ${stat(fmtN(issue.n), 'NYC 311 service requests', true)}
      ${stat(fmtN(cn), 'closed by the city')}
      ${stat(fmtN(nf), '"nothing found" closures', true)}
      ${stat(fmtN(rn), 'new request after a closure', true)}
      ${stat(ard != null ? ard.toFixed(1) + 'd' : 'n/a', 'avg. closure to next request')}
      ${stat(fmtN(issue.episode_count), 'reporting episodes')}
    </div>
    <div class="spark"><div class="cap">Every red band is a reporting episode separated from the next by more than this location's adaptive quiet-window threshold. Bands do not identify a physical tent. ${esc(issue.first_seen)} to today.</div>${sparkline(issue)}</div>

    <h2>Who is accountable</h2>
    <div class="card">
      ${officialBlock}
      <div class="who-verdict">What the record shows: the city closed <b>${fmtN(cn)} requests</b>${nf ? `, including ${fmtN(nf)} with a "nothing found" response` : ''}. ${active ? 'The current reporting episode remains active under the published quiet-window rule.' : 'The same block kept being reported again.'} Responding agency on the requests: ${esc(issue.agency || 'NYC')}.</div>
    </div>

    ${law ? `<h2>What the law says</h2>
    <div class="card law">
      <div class="law-code">${esc(law.code)}</div>
      <div class="law-rule">${esc(law.rule)}</div>
      <div class="law-pen"><span>Penalty</span> ${esc(law.penalty)}</div>
      <div class="law-also">${esc(law.also)} &middot; <a href="${esc(law.src)}">read the statute &#8594;</a></div>
    </div>` : ''}

    <h2>How we define this spot</h2>
    <div class="card disclose">A report is one NYC 311 service-request record. For configured campaign addresses, positive agency observations and outreach contacts anchor occupation support. The continuity window is four times that address's median gap between all report days after support begins, bounded to 30-60 days; a longer gap between supporting observations creates an interruption candidate. A gap becomes a likely interruption only when it is at least twice the window, or at least 1.5 times the window and contains a negative-only inspection. Same-day positive and negative inspections remain visible as conflicts. The 0-100 confidence result weights report frequency, supported span, recency, and consistency. It is an evidence index, not a probability, proof of one unchanged object, or proof of cleanup. Other map locations still use the broader reporting-episode method.</div>

    <div class="stamp">${stamp}<br>This page documents a <b>government's</b> response to a public-safety obstruction. It is not about, and does not identify, any individual experiencing homelessness. They are failed by this inaction, not the cause of it.</div>
  </details>

  ${T.posts && T.posts.length ? `<div class="ugc" style="margin-top:20px">
    <div class="hdr"><b>Neighbor reports</b></div>
    ${T.posts.map(p => `<div class="q">${esc(p.text || '')}${p.photo ? ' (photo on file)' : ''}<div style="font-size:11px;color:var(--mut);margin-top:4px">${esc(p.ts ? p.ts.slice(0,10) : '')}</div></div>`).join('')}
  </div>` : ''}

  <section class="start-band">
    <h2>${campaign ? 'Your block can be next.' : 'Make this a public campaign.'}</h2>
    <p>${campaign ? 'Find an active issue near you and give neighbors one permanent place to confirm it, organize, and track what happens.' : 'Confirm this issue is still present and start organizing from the city-backed record.'}</p>
    <a class="start-link" href="/start${campaign ? '' : `?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`}">${campaign ? 'Start a campaign' : 'Start this campaign'}</a>
  </section>

${actScript}${PULSE_BEACON}
</div></body></html>`;
}

// ---------- AREA (ZONE) SHARE: many issue-cells bundled under one permalink ----------
// A citizen frames a cluster on the map and shares it as ONE /a/<id> URL. The member set is frozen
// at mint; the page recomputes their stats live. Reuses councilFor/officials/disparity/narrative.
const AREA_TYPE_COLORS = {
  'Encampment': '#ff6b4a', 'Drug Activity': '#c77dff',
  'Homeless Person Assistance': '#4ad6c8', 'Panhandling': '#ffd166',
};
const AREA_MAX_MEMBERS = 400; // a "zone" is a cluster, not the whole city

// Aggregate the city's own record across a set of member issues.
function areaStats(members) {
  let n = 0, closed = 0, nf = 0, returned = 0, activeSpots = 0, flareups = 0;
  let oldest = null, worst = null;
  const typeAgg = {};                       // type -> { spots, n }
  const districts = new Set(), boards = new Set(), boroughs = [];
  for (const i of members) {
    n += Number(i.n) || 0;
    closed += Number(i.closed_n) || 0;
    nf += Number(i.nothing_found) || 0;
    returned += Number(i.returned_n) || 0;
    flareups += Number(i.episode_count) || 0;
    if (i.status === 'active') activeSpots++;
    if (i.first_seen && (!oldest || i.first_seen < oldest)) oldest = i.first_seen;
    if (!worst || (Number(i.score) || 0) > (Number(worst.score) || 0)) worst = i;
    const ta = typeAgg[i.type] || (typeAgg[i.type] = { spots: 0, n: 0 });
    ta.spots++; ta.n += Number(i.n) || 0;
    const d = parseInt(String(i.council || '').match(/\d+/)?.[0] || '', 10);
    if (Number.isFinite(d)) districts.add(d);
    if (i.board) boards.add(i.board);
    const b = titleCase(i.borough);
    if (b && b !== 'Unspecified' && !boroughs.includes(b)) boroughs.push(b);
  }
  return { spots: members.length, n, closed, nf, returned, activeSpots, flareups, oldest, worst,
    typeAgg, districts: [...districts].sort((a, b) => a - b), boards: [...boards], boroughs };
}

// Human title for a zone — anchored to its worst spot's block + borough.
function areaTitle(stats) {
  const boro = stats.boroughs[0] || 'NYC';
  const anchor = titleCase(stats.worst && stats.worst.addr);
  return `${fmtN(stats.spots)} ignored spot${stats.spots !== 1 ? 's' : ''}`
    + (anchor ? ` around ${anchor}` : '') + `, ${boro}`;
}

// The X/copy tweet for a zone.
function areaTweet(stats, url) {
  const where = titleCase(stats.worst && stats.worst.addr) ? `Around ${titleCase(stats.worst.addr)}` : (stats.boroughs[0] || 'NYC');
  return `${where}: ${fmtN(stats.spots)} chronic spots on NYC's own 311 record — ${fmtN(stats.n)} reports, closed ${fmtN(stats.closed)}×. ${fmtN(stats.activeSpots)} records remain active. The receipt: ${url}`;
}

// Resolve verified, named council members spanning the zone's districts (deduped).
function areaOfficials(districts) {
  const seen = new Set(), out = [];
  for (const d of districts) {
    const m = councilFor(d);
    if (m && m.member && m.verified && !seen.has(m.member)) { seen.add(m.member); out.push(m); }
  }
  return out;
}

function renderArea(area) {
  let bbox = {}, types = [], memberKeys = [], snap = {};
  try { bbox = JSON.parse(area.bbox); } catch {}
  try { types = JSON.parse(area.types); } catch {}
  try { memberKeys = JSON.parse(area.member_keys); } catch {}
  try { snap = area.snapshot ? JSON.parse(area.snapshot) : {}; } catch {}

  // Member issues, ranked worst-first. User mints freeze their set; hotspots recompute live from
  // the bbox each render (so an auto-zone tracks the block as spots resolve/emerge).
  let members;
  if (area.kind === 'hotspot') {
    members = ISSUES.filter(i =>
      i.lat >= bbox.s && i.lat <= bbox.n && i.lng >= bbox.w && i.lng <= bbox.e &&
      types.includes(i.type) && i.status === 'active');
  } else {
    members = memberKeys.map(k => ISSUE_BY_KEY.get(k)).filter(Boolean);
  }
  members.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const st = areaStats(members);
  const title = area.title || areaTitle(st);
  const shareUrl = `${PUBLIC_ORIGIN}/a/${area.id}`;
  const oldestDays = daysSince(st.oldest);
  const oldestYrs = fmtYears(oldestDays);
  const allActive = st.activeSpots === st.spots && st.spots > 1;

  const ogTitle = `${fmtN(st.spots)} spots. ${fmtN(st.n)} reports. The city closed them ${fmtN(st.closed)} times.`;
  const ogDesc = `${title}. NYC's own 311 record: ${fmtN(st.n)} reports across ${fmtN(st.spots)} nearby spots, closed ${fmtN(st.closed)} times`
    + (st.nf ? `, ${fmtN(st.nf)} as "nothing found"` : '') + `. ${fmtN(st.activeSpots)} still active.`;

  // Points for the inline mini-map.
  const pts = members.map(i => ({ lat: i.lat, lng: i.lng, c: AREA_TYPE_COLORS[i.type] || '#ff6b4a',
    n: i.n, active: i.status === 'active' }));
  const bb = [bbox.s, bbox.w, bbox.n, bbox.e];

  // Type breakdown chips.
  const typeChips = Object.entries(st.typeAgg)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([t, v]) => `<span class="tchip"><i style="background:${AREA_TYPE_COLORS[t] || '#888'}"></i>${esc(t)} &middot; ${fmtN(v.spots)} spot${v.spots !== 1 ? 's' : ''}</span>`)
    .join('');

  // Ranked member list (cap 25, note remainder).
  const CAP = 25;
  const rows = members.slice(0, CAP).map(i => {
    const eps = Array.isArray(i.episodes) ? i.episodes : [];
    const epStart = eps.length ? eps[eps.length - 1][0] : i.first_seen;
    const dayN = daysSince(epStart) || 0;
    const url = `${PUBLIC_ORIGIN}/c?t=${encodeURIComponent(i.type)}&id=${encodeURIComponent(i.id)}`;
    const badge = i.status === 'active'
      ? `<span class="mb-act">active ${humanizeDur(dayN)}</span>`
      : `<span class="mb-res">likely resolved</span>`;
    return `<a class="mrow" href="${esc(url)}">
      <span class="mdot" style="background:${AREA_TYPE_COLORS[i.type] || '#888'}"></span>
      <span class="mtxt"><span class="maddr">${esc(titleCase(i.addr) || 'this location')}</span>
      <span class="mmeta">${esc(i.type)} &middot; ${fmtN(i.n)} reports &middot; closed ${fmtN(Number(i.closed_n) || 0)}× ${badge}</span></span>
      <span class="mgo">&#8594;</span></a>`;
  }).join('');
  const moreRow = members.length > CAP
    ? `<div class="mmore">+ ${fmtN(members.length - CAP)} more spot${members.length - CAP !== 1 ? 's' : ''} in this area</div>` : '';

  // Who's accountable across the zone.
  const officials = areaOfficials(st.districts);
  let whoHtml;
  if (officials.length) {
    whoHtml = officials.map(m =>
      `<div class="who-line"><b>${esc(m.member)}</b> &mdash; Council District ${m.district}${m.borough ? ' &middot; ' + esc(m.borough) : ''}`
      + (m.x ? ` &middot; <a href="https://twitter.com/${esc(m.x.replace(/^@/, ''))}">@${esc(m.x.replace(/^@/, ''))}</a>` : '') + `</div>`
    ).join('');
  } else {
    whoHtml = `<div class="who-line">Council District${st.districts.length !== 1 ? 's' : ''} ${st.districts.join(', ') || '—'} &middot; <a href="https://council.nyc.gov/districts/">find &amp; name the members &#8594;</a></div>`;
  }

  const stat = (big, label, alarm) =>
    `<div class="stat"><div class="big ${alarm ? 'alarm' : ''}">${big}</div><div class="lbl">${label}</div></div>`;
  const shareCount = Number(area.share_count) || 0;
  const viewCount = (Number(area.view_count) || 0);

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(ogTitle)}</title>
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:url" content="${esc(shareUrl)}">
<meta property="og:site_name" content="unignorable">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(ogDesc)}">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
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
  .kicker{margin:22px 0 4px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--alarm);font-weight:700}
  .day-hero{font-size:72px;line-height:.92;font-weight:800;letter-spacing:-.02em;margin:6px 0 2px;color:var(--alarm)}
  .day-sub{font-size:14px;color:var(--mut);margin:4px 0 0}
  .lead{font-size:18px;line-height:1.42;margin:12px 0 0;color:var(--ink)}
  .indict{font-size:16px;line-height:1.5;background:var(--card);border:1px solid var(--line);border-left:3px solid var(--alarm);border-radius:10px;padding:14px 16px;margin:18px 0}
  .indict b{color:var(--alarm)}
  #amap{height:260px;border-radius:12px;border:1px solid var(--line);margin:16px 0 4px;background:#0a0f17}
  .leaflet-container{background:#0a0f17}
  .tchips{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 4px}
  .tchip{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:5px 11px}
  .tchip i{width:9px;height:9px;border-radius:50%;display:inline-block}
  h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);margin:30px 0 10px;font-weight:700}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0 8px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 10px;text-align:center}
  .stat .big{font-size:22px;font-weight:800}
  .stat .big.alarm{color:var(--alarm)}
  .stat .lbl{font-size:11px;color:var(--mut);margin-top:3px;line-height:1.3}
  .mlist{margin:6px 0 0}
  .mrow{display:flex;align-items:center;gap:11px;padding:12px 4px;border-bottom:1px solid var(--line);text-decoration:none;color:var(--ink)}
  .mrow:last-of-type{border-bottom:none}
  .mdot{width:11px;height:11px;border-radius:50%;flex:none}
  .mtxt{flex:1;min-width:0}
  .maddr{display:block;font-weight:700;font-size:14px}
  .mmeta{display:block;font-size:12px;color:var(--mut);margin-top:2px}
  .mb-act{color:var(--alarm);font-weight:700}
  .mb-res{color:var(--mut)}
  .mgo{color:var(--amber);flex:none}
  .mmore{font-size:13px;color:var(--mut);padding:12px 4px 0}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
  .who-line{font-size:14px;margin:6px 0}
  .who-line b{color:var(--ink)}
  .share{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:18px 0 6px}
  .btn{display:inline-block;padding:11px 16px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none;cursor:pointer;border:none}
  .btn.x{background:var(--alarm);color:#fff}
  .btn.ghost{background:transparent;border:1px solid var(--line);color:var(--ink)}
  .scount{font-size:12px;color:var(--mut)}
  .stamp{margin-top:26px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--mut)}
</style></head><body><div class="wrap">
  <div class="mast"><a class="word" href="${esc(PUBLIC_ORIGIN)}/map">UN<b>IGNOR</b>ABLE</a><span class="tag">a public receipt</span></div>

  <div class="kicker">${esc(st.boroughs.join(', ') || 'NYC')} &middot; ${fmtN(st.spots)} spot${st.spots !== 1 ? 's' : ''}</div>
  <div class="day-hero">${fmtN(st.spots)}</div>
  <div class="day-sub">chronic spots the city keeps closing in this area${allActive ? ' &middot; every one still active today' : (st.activeSpots ? ` &middot; ${fmtN(st.activeSpots)} still open today` : '')}</div>
  <p class="lead">${esc(title)}.</p>

  <div class="indict">Across ${st.spots === 1 ? 'this spot' : `these <b>${fmtN(st.spots)} spots</b>`}, NYC 311 was told <b>${fmtN(st.n)} times</b> and the city closed the cases <b>${fmtN(st.closed)} times</b>${st.nf ? `, including <b>${fmtN(st.nf)}</b> that claimed nothing was there` : ''}. ${allActive ? 'Every one is still active today.' : (st.activeSpots ? `<b>${fmtN(st.activeSpots)}</b> ${st.activeSpots === 1 ? 'is' : 'are'} still active today.` : '')}${oldestDays != null ? ` The oldest has been on the record since ${esc(fmtDate(st.oldest))} — ${esc(oldestYrs)}.` : ''} Knowing is not fixing.</div>

  <div id="amap"></div>
  <div class="tchips">${typeChips}</div>

  <h2>The record across this area</h2>
  <div class="grid">
    ${stat(fmtN(st.n), 'times reported to 311', true)}
    ${stat(fmtN(st.closed), 'closed by the city')}
    ${stat(fmtN(st.nf), '"nothing found" closures', true)}
    ${stat(fmtN(st.returned), 'came back after closing', true)}
    ${stat(fmtN(st.spots), 'distinct spots')}
    ${stat(fmtN(st.flareups), 'separate flare-ups')}
  </div>

  <h2>Every spot in this area</h2>
  <div class="mlist">${rows}${moreRow}</div>

  <h2>Who is accountable</h2>
  <div class="card">${whoHtml}</div>

  <div class="share">
    <a class="btn x" id="xbtn" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(areaTweet(st, shareUrl))}" target="_blank" rel="noopener" onclick="bumpShare()">Post to X</a>
    <button class="btn ghost" id="copybtn" onclick="bumpShare();copyLink()">Copy link</button>
    <span class="scount">${shareCount ? `shared ${fmtN(shareCount)} time${shareCount !== 1 ? 's' : ''} &middot; ` : ''}viewed ${fmtN(viewCount)} time${viewCount !== 1 ? 's' : ''}</span>
  </div>

  <div class="stamp">Built from New York City's own 311 open data (dataset erm2-nwe9)${st.oldest ? `, ${fmtN(st.spots)} nearby spots from ${esc(fmtDate(st.oldest))} to today` : ''}. This page documents a <b>government's</b> response to public-safety obstructions. It is not about, and does not identify, any individual experiencing homelessness. They are failed by this inaction, not the cause of it.</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var PTS=${JSON.stringify(pts)}, BB=${JSON.stringify(bb)}, AID=${JSON.stringify(area.id)};
(function(){
  var m=L.map('amap',{zoomControl:true,preferCanvas:true,scrollWheelZoom:false});
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'© OpenStreetMap © CARTO',maxZoom:19}).addTo(m);
  var cv=L.canvas({padding:.5});
  PTS.forEach(function(p){
    L.circleMarker([p.lat,p.lng],{renderer:cv,radius:Math.min(22,4+Math.sqrt(p.n)*0.9),
      color:p.c,weight:1,fillColor:p.c,fillOpacity:p.active?0.5:0.16,opacity:p.active?0.85:0.4}).addTo(m);
  });
  try{ m.fitBounds([[BB[0],BB[1]],[BB[2],BB[3]]],{padding:[24,24]}); }catch(e){ m.setView([40.735,-73.98],13); }
})();
function bumpShare(){ fetch('/api/area/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:AID})}).catch(function(){}); }
function copyLink(){ var url=${JSON.stringify(shareUrl)};
  (navigator.clipboard?navigator.clipboard.writeText(url):Promise.reject()).then(function(){
    var el=document.getElementById('copybtn');var o=el.textContent;el.textContent='Copied!';setTimeout(function(){el.textContent=o;},1500);
  }).catch(function(){window.prompt('Copy this link:',url);});
}
</script>
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

// ---------- AUTO HOTSPOTS: the worst active clusters get STABLE standing URLs (/a/<slug>) ----------
// Computed at boot from ISSUES (fresh on every deploy + daily refresh). Slugs are geography-stable:
// a curated landmark if the zone centroid is near one, else a borough+grid slug that doesn't drift
// as membership shifts. Membership recomputes live per request (renderArea, kind==='hotspot').
const BORO_ABBR = { Manhattan: 'mn', Brooklyn: 'bk', Queens: 'qn', Bronx: 'bx', 'Staten Island': 'si' };
// Marquee NYC locations — a zone that CONTAINS one adopts its pretty slug + label (the nearest to the
// zone's centre wins). Naming the GEOGRAPHY only, never the people.
const CURATED_LANDMARKS = [
  { slug: 'intrepid',         label: 'the Intrepid',        lat: 40.7645, lng: -73.9997 },
  { slug: 'columbus-circle',  label: 'Columbus Circle',     lat: 40.7681, lng: -73.9819 },
  { slug: 'port-authority',   label: 'Port Authority',      lat: 40.7570, lng: -73.9903 },
  { slug: 'penn-station',     label: 'Penn Station',        lat: 40.7506, lng: -73.9935 },
  { slug: 'herald-square',    label: 'Herald Square',       lat: 40.7497, lng: -73.9880 },
  { slug: 'union-square',     label: 'Union Square',        lat: 40.7359, lng: -73.9911 },
  { slug: 'tompkins-square',  label: 'Tompkins Square',     lat: 40.7265, lng: -73.9815 },
  { slug: 'atlantic-barclays',label: 'Atlantic Terminal',   lat: 40.6844, lng: -73.9765 },
  { slug: 'fordham-plaza',    label: 'Fordham Plaza',       lat: 40.8610, lng: -73.8900 },
  { slug: 'jamaica-center',   label: 'Jamaica Center',      lat: 40.7020, lng: -73.8010 },
  { slug: '125th-lex',        label: '125th & Lexington',   lat: 40.8046, lng: -73.9378 },
];
function computeHotspots() {
  const g = 0.006; // ~500m grid
  const active = ISSUES.filter(i => i.status === 'active' && Number.isFinite(i.lat) && Number.isFinite(i.lng));
  const cells = new Map();
  for (const i of active) {
    const ci = Math.round(i.lat / g), cj = Math.round(i.lng / g), k = ci + '_' + cj;
    let c = cells.get(k); if (!c) { c = { ci, cj, items: [], score: 0 }; cells.set(k, c); }
    c.items.push(i); c.score += Number(i.score) || 0;
  }
  // PEAK-GROWTH clustering: greedily pick the densest unclaimed cell, grow a compact fixed-radius
  // zone (±RAD cells ~ a kilometer) around it, and CLAIM those cells so zones stay separate. This
  // deliberately avoids connected-components, which chains every dense cell in a borough into one
  // giant blob. A zone is a block-cluster, not a borough.
  const RAD = 1; // ±1 cell (~0.6km) each way → a compact ~1.4km zone
  const ranked = [...cells.values()]
    .filter(c => c.items.length >= 2)
    .sort((a, b) => (b.items.length - a.items.length) || (b.score - a.score));
  const claimed = new Set(), zones = [];
  for (const peak of ranked) {
    const pk = peak.ci + '_' + peak.cj;
    if (claimed.has(pk)) continue;
    const members = [], zoneCells = [];
    for (let di = -RAD; di <= RAD; di++) for (let dj = -RAD; dj <= RAD; dj++) {
      const nk = (peak.ci + di) + '_' + (peak.cj + dj), nc = cells.get(nk);
      if (nc && !claimed.has(nk)) { members.push(...nc.items); zoneCells.push(nk); }
    }
    if (members.length < 5) continue; // a real cluster, not two lonely dots
    zoneCells.forEach(k => claimed.add(k));
    zones.push({ members, totalScore: members.reduce((s, m) => s + (Number(m.score) || 0), 0) });
  }
  const used = new Set(), out = [];
  // Rank zones by DENSITY of distinct chronic spots (the "many bubbles clustered here" a user sees),
  // tie-broken by total severity — so a wall of encampments isn't buried under a few mega-volume spots.
  for (const z of zones.sort((a, b) => (b.members.length - a.members.length) || (b.totalScore - a.totalScore)).slice(0, 24)) {
    const lats = z.members.map(m => m.lat), lngs = z.members.map(m => m.lng), pad = 0.0015;
    const bbox = { s: Math.min(...lats) - pad, w: Math.min(...lngs) - pad, n: Math.max(...lats) + pad, e: Math.max(...lngs) + pad };
    const clat = (bbox.s + bbox.n) / 2, clng = (bbox.w + bbox.e) / 2;
    // Stats from the SAME bbox query renderArea uses (not the claimed-cell subset) so the page's
    // hero/grid and this title/snapshot never disagree.
    const zmembers = ISSUES.filter(i =>
      i.lat >= bbox.s && i.lat <= bbox.n && i.lng >= bbox.w && i.lng <= bbox.e && i.status === 'active');
    const st = areaStats(zmembers);
    // A landmark INSIDE the zone bbox claims it; nearest-to-centre wins. Else an honest geo-slug.
    let mark = null, best = Infinity;
    for (const L of CURATED_LANDMARKS) {
      if (L.lat < bbox.s || L.lat > bbox.n || L.lng < bbox.w || L.lng > bbox.e) continue;
      const d = (clat - L.lat) ** 2 + (clng - L.lng) ** 2;
      if (d < best) { best = d; mark = L; }
    }
    let slug = mark ? mark.slug : `${BORO_ABBR[st.boroughs[0]] || 'nyc'}-${Math.round(clat * 1000)}-${Math.abs(Math.round(clng * 1000))}`;
    if (used.has(slug)) { let n = 2; while (used.has(slug + '-' + n)) n++; slug = slug + '-' + n; }
    used.add(slug);
    // Countless place-only title (live counts come from the page's hero/grid, never a stale bake).
    // Landmark name if one claims the zone, else the worst spot's block.
    const boro = st.boroughs[0] || 'NYC';
    const anchor = titleCase(st.worst && st.worst.addr);
    const place = mark ? mark.label : anchor;
    const title = place ? `Around ${place}, ${boro}` : `A cluster in ${boro}`;
    out.push({ slug, bbox, types: Object.keys(st.typeAgg), title,
      snapshot: { spots: st.spots, n: st.n, closed: st.closed, activeSpots: st.activeSpots }, score: z.totalScore });
  }
  return out;
}
let HOTSPOTS = [];
try {
  HOTSPOTS = computeHotspots();
  for (const h of HOTSPOTS) ugc.upsertHotspot(h);
  console.log(`hotspots: ${HOTSPOTS.length} standing zones`);
} catch (e) { console.error('hotspot compute failed:', e && e.message); }

// The /hotspots index — a home for the standing zone URLs (worst clusters first).
function renderHotspotsIndex() {
  const rows = HOTSPOTS.map(h => {
    const s = h.snapshot || {};
    return `<a class="hrow" href="/a/${esc(h.slug)}">
      <span class="htxt"><span class="httl">${esc(h.title)}</span>
      <span class="hmeta">${fmtN(s.n || 0)} reports &middot; closed ${fmtN(s.closed || 0)}× &middot; ${fmtN(s.spots || 0)} spots</span></span>
      <span class="hslug">/a/${esc(h.slug)} &#8594;</span></a>`;
  }).join('');
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>The worst ignored zones — unignorable</title>
<style>
  :root{--bg:#0b0d10;--card:#14171c;--ink:#e8eaed;--mut:#8b9098;--line:#262b32;--alarm:#ff4d4d;--amber:#ffb020}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  a{color:var(--amber);text-decoration:none}.wrap{max-width:680px;margin:0 auto;padding:20px 18px 64px}
  .mast{display:flex;align-items:center;justify-content:space-between;padding:6px 0 18px;border-bottom:1px solid var(--line)}
  .word{font-weight:800;letter-spacing:.06em;font-size:14px;color:var(--ink)}.word b{color:var(--alarm)}
  h1{font-size:24px;font-weight:800;margin:22px 0 4px}.sub{color:var(--mut);font-size:14px;margin:0 0 12px}
  .hrow{display:flex;align-items:center;gap:11px;padding:14px 4px;border-bottom:1px solid var(--line);color:var(--ink)}
  .htxt{flex:1;min-width:0}.httl{display:block;font-weight:700;font-size:15px}.hmeta{display:block;font-size:12px;color:var(--mut);margin-top:2px}
  .hslug{color:var(--amber);flex:none;font-size:12px}
</style></head><body><div class="wrap">
  <div class="mast"><a class="word" href="${esc(PUBLIC_ORIGIN)}/map">UN<b>IGNOR</b>ABLE</a><span style="font-size:11px;color:var(--mut)">standing zones</span></div>
  <h1>The worst ignored zones</h1>
  <p class="sub">Each is a permanent link. Auto-detected from NYC's own 311 record, refreshed daily.</p>
  ${rows || '<p class="sub">No active clusters right now.</p>'}
</div></body></html>`;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const p = Math.PI / 180;
  const a = 0.5 - Math.cos((lat2 - lat1) * p) / 2
    + Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lng2 - lng1) * p)) / 2;
  return 12742000 * Math.asin(Math.sqrt(a));
}

function renderCampaignStart(selectedIssue) {
  const selected = selectedIssue ? {
    type: selectedIssue.type, id: selectedIssue.id, addr: titleCase(selectedIssue.addr),
    borough: titleCase(selectedIssue.borough), reports: selectedIssue.n,
    currentDays: selectedIssue.current_days || 0,
    campaign: !!ugc.getCampaign(key(selectedIssue.type, selectedIssue.id)),
  } : null;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="index,follow"><title>Start a campaign on your block — unignorable</title>
<style>
  :root{--bg:#0b0d10;--ink:#e8eaed;--mut:#969ba4;--line:#2b3038;--alarm:#ff4d4d;--amber:#ffb020;--field:#14171c}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  button,input{font:inherit}button{cursor:pointer}.wrap{max-width:680px;margin:0 auto;padding:20px 18px 72px}
  .mast{display:flex;align-items:center;justify-content:space-between;padding:6px 0 18px;border-bottom:1px solid var(--line)}
  .word{font-weight:800;letter-spacing:.06em;font-size:14px;color:var(--ink);text-decoration:none}.word b{color:var(--alarm)}
  .map-link{color:var(--mut);font-size:13px}.hero{padding:34px 0 26px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--alarm);font-weight:800}
  h1{font-size:38px;line-height:1.08;margin:8px 0 12px;max-width:560px}p{margin:0;color:var(--mut)}
  .step{padding:24px 0;border-top:1px solid var(--line)}.step h2{font-size:17px;margin:0 0 5px}.step>p{font-size:14px;margin-bottom:14px}
  .search{display:grid;grid-template-columns:1fr auto;gap:8px}.field{width:100%;background:var(--field);border:1px solid var(--line);border-radius:6px;color:var(--ink);padding:12px 13px;min-height:46px}
  .field:focus{outline:2px solid var(--amber);outline-offset:1px}.btn{border:0;border-radius:6px;background:var(--amber);color:#090a0c;font-weight:800;padding:11px 16px;min-height:46px}
  .btn:disabled{opacity:.5;cursor:not-allowed}.results{margin-top:12px;border-top:1px solid var(--line)}
  .result{width:100%;display:flex;align-items:center;justify-content:space-between;gap:14px;text-align:left;background:transparent;color:var(--ink);border:0;border-bottom:1px solid var(--line);padding:14px 2px}
  .result:hover,.result:focus{background:#11141a;outline:none}.result-main{min-width:0}.result-title{display:block;font-weight:750}.result-meta{display:block;color:var(--mut);font-size:12px;margin-top:2px}.arrow{color:var(--amber);font-weight:800}
  .selected{border-left:3px solid var(--amber);padding:14px 15px;background:var(--field);margin-bottom:16px}.selected b{display:block;font-size:17px}.selected span{display:block;color:var(--mut);font-size:13px;margin-top:3px}
  .label{display:block;font-size:13px;font-weight:700;margin:13px 0 6px}.check{display:flex;align-items:flex-start;gap:9px;margin:14px 0;color:var(--ink);font-size:14px}.check input{margin-top:4px;accent-color:var(--amber)}
  .fine{font-size:12px;color:var(--mut);margin:10px 0 16px}.status{font-size:13px;color:var(--mut);margin-top:10px;min-height:20px}.status.error{color:#ff7b7b}
  [hidden]{display:none!important}@media(max-width:520px){h1{font-size:32px}.search{grid-template-columns:1fr}.search .btn{width:100%}}
</style></head><body><div class="wrap">
  <div class="mast"><a class="word" href="${esc(CANARY_URL)}">UN<b>IGNOR</b>ABLE</a><a class="map-link" href="/map">Explore NYC</a></div>
  <div class="hero"><div class="eyebrow">Your block can be next</div><h1>Start a public campaign from the city's own record.</h1><p>Find a recurring issue, confirm it is still present, and give the block one permanent place to organize.</p></div>
  <section class="step"><h2>1. Find the block</h2><p>Search an address or intersection in New York City.</p>
    <form id="search-form" class="search"><input id="address" class="field" autocomplete="street-address" placeholder="Address or intersection" required><button class="btn" type="submit">Search</button></form>
    <div id="search-status" class="status" aria-live="polite"></div><div id="results" class="results"></div>
  </section>
  <section id="organize" class="step" ${selected ? '' : 'hidden'}><h2>2. Start the campaign</h2><p>Organizer contact stays private. The campaign uses only the public city record and approved neighbor evidence.</p>
    <div id="selected" class="selected"></div>
    <form id="campaign-form">
      <label class="label" for="email">Email for campaign updates</label><input id="email" class="field" type="email" autocomplete="email" maxlength="254" required>
      <label class="check"><input id="confirmed" type="checkbox" required><span>I have seen this issue at this location recently.</span></label>
      <p class="fine">Your email is stored privately for campaign verification and updates. It is never shown on the public page or shared with city agencies.</p>
      <button id="start-button" class="btn" type="submit">Start campaign</button><div id="campaign-status" class="status" aria-live="polite"></div>
    </form>
  </section>
</div>
<script>
var chosen=${JSON.stringify(selected)};
var resultsEl=document.getElementById('results'), organize=document.getElementById('organize');
function choose(issue){
  chosen=issue;organize.hidden=false;
  document.getElementById('selected').innerHTML='<b>'+escapeHtml(issue.type)+' near '+escapeHtml(issue.addr||'this block')+'</b><span>'+(issue.reports||0).toLocaleString()+' service requests in the approximate-block record'+(issue.currentDays?' · current reporting episode spans '+issue.currentDays+' days':'')+(issue.campaign?' · campaign already active':'')+'</span>';
  document.getElementById('start-button').textContent=issue.campaign?'Join campaign':'Start campaign';
  organize.scrollIntoView({behavior:'smooth',block:'start'});
}
function escapeHtml(s){var d=document.createElement('div');d.textContent=s||'';return d.innerHTML;}
if(chosen)choose(chosen);
document.getElementById('search-form').addEventListener('submit',async function(e){
  e.preventDefault();var q=document.getElementById('address').value.trim(), status=document.getElementById('search-status');
  status.className='status';status.textContent='Searching…';resultsEl.innerHTML='';
  try{
    var places=await fetch('/api/geocode?q='+encodeURIComponent(q)).then(function(r){return r.json()});
    if(!places.length)throw new Error('No NYC location found.');
    var nearby=await fetch('/api/campaign/nearby?lat='+places[0].lat+'&lng='+places[0].lng).then(function(r){return r.json()});
    if(!nearby.items||!nearby.items.length)throw new Error('No active city record found within walking distance.');
    status.textContent=nearby.items.length+' active records nearby. Select the matching block.';
    nearby.items.forEach(function(issue){var b=document.createElement('button');b.type='button';b.className='result';b.innerHTML='<span class="result-main"><span class="result-title">'+escapeHtml(issue.type)+' · '+escapeHtml(issue.addr||'Approximate block')+'</span><span class="result-meta">'+Math.round(issue.distance)+' m away · '+issue.reports.toLocaleString()+' reports'+(issue.campaign?' · active campaign':'')+'</span></span><span class="arrow">→</span>';b.onclick=function(){choose(issue)};resultsEl.appendChild(b)});
  }catch(err){status.className='status error';status.textContent=err.message||'Search failed. Try again.';}
});
document.getElementById('campaign-form').addEventListener('submit',async function(e){
  e.preventDefault();if(!chosen)return;var button=document.getElementById('start-button'),status=document.getElementById('campaign-status');button.disabled=true;status.className='status';status.textContent='Creating campaign…';
  try{var response=await fetch('/api/campaign/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:chosen.type,id:chosen.id,email:document.getElementById('email').value,confirmed:document.getElementById('confirmed').checked})});var out=await response.json();if(!response.ok)throw new Error(out.error||'Could not start campaign.');if(window.pulse)window.pulse('campaign_started',{type:chosen.type,id:chosen.id});location.href=out.url;}catch(err){button.disabled=false;status.className='status error';status.textContent=err.message||'Could not start campaign.';}
});
</script>${PULSE_BEACON}</body></html>`;
}

function renderActionReceipt(receipt) {
  const issue = ISSUE_BY_KEY.get(receipt.issue_key);
  const label = receipt.action_type === 'email_official' ? 'Official email draft' : 'Official X post';
  const location = issue ? displayLocation(issue) : 'campaign record';
  const campaignUrl = issue
    ? `/c?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}` : '/map';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Action receipt | Unignorable</title><style>
  :root{--bg:#0b0d10;--card:#14171c;--ink:#e8eaed;--mut:#8b9098;--line:#262b32;--amber:#ffb020}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:640px;margin:0 auto;padding:32px 18px 64px}a{color:var(--amber)}h1{font-size:30px;margin:28px 0 4px}.sub{color:var(--mut)}.receipt{margin-top:24px;border-top:1px solid var(--line)}.row{display:grid;grid-template-columns:170px 1fr;gap:14px;padding:14px 0;border-bottom:1px solid var(--line)}.row span{color:var(--mut)}.count{font-size:34px;color:var(--amber);font-weight:800}.confirm{margin-top:20px;padding:10px 15px;border:0;border-radius:6px;background:var(--amber);font-weight:800;cursor:pointer}.note{margin-top:24px;padding:14px;border-left:3px solid var(--amber);background:var(--card);font-size:13px;color:var(--mut)}@media(max-width:520px){.row{grid-template-columns:1fr;gap:3px}}
  </style></head><body><main class="wrap"><a href="${esc(campaignUrl)}">UNIGNORABLE</a><h1>Permanent action receipt</h1><p class="sub">${esc(label)} for ${esc(location)}</p><div class="receipt">
  <div class="row"><span>Receipt</span><b>${esc(receipt.token)}</b></div>
  <div class="row"><span>Prepared</span><b>${esc(new Date(receipt.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' }))} ET</b></div>
  <div class="row"><span>Target</span><b>${esc(receipt.target || 'official channel')}</b></div>
  <div class="row"><span>Sender confirmation</span><b>${receipt.sender_confirmed_at ? esc(new Date(receipt.sender_confirmed_at).toLocaleString('en-US', { timeZone: 'America/New_York' })) + ' ET' : 'Not confirmed'}</b></div>
  <div class="row"><span>Tracked-link requests</span><b class="count">${fmtN(receipt.link_requests || 0)}</b></div>
  <div class="row"><span>First link request</span><b>${receipt.first_link_request_at ? esc(new Date(receipt.first_link_request_at).toLocaleString('en-US', { timeZone: 'America/New_York' })) + ' ET' : 'None recorded'}</b></div>
  <div class="row"><span>Last link request</span><b>${receipt.last_link_request_at ? esc(new Date(receipt.last_link_request_at).toLocaleString('en-US', { timeZone: 'America/New_York' })) + ' ET' : 'None recorded'}</b></div>
  </div>${receipt.sender_confirmed_at ? '' : `<button class="confirm" onclick="confirmSent(this)">I sent this</button>`}<div class="note">This receipt proves that Unignorable prepared the action and records requests to its unique evidence link. Sender confirmation is a user assertion, not delivery proof. A link request may come from a human or a security scanner and does not prove that the named official personally read it. Email opens cannot be reliably measured from a draft sent through the resident's mail app.</div></main><script>async function confirmSent(button){button.disabled=true;var response=await fetch('/api/action/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(receipt.token)}})});if(response.ok)location.reload();else button.disabled=false;}</script>${PULSE_BEACON}</body></html>`;
}

async function handleRequest(req, res) {
  const u = new URL(req.url, 'http://x');

  if (u.pathname === '/healthz') {
    return send(res, 200, JSON.stringify({ ok: true, issues: ISSUES.length, dataThrough: ISSUES.reduce((a, i) => i.last_seen > a ? i.last_seen : a, '') }), 'application/json', { 'Cache-Control': 'no-store' });
  }

  const trackedMatch = u.pathname.match(/^\/r\/([a-f0-9]{32})$/);
  if (trackedMatch && req.method === 'GET') {
    const receipt = ugc.getActionReceipt(trackedMatch[1]);
    if (!receipt) return send(res, 404, 'Unknown receipt.', 'text/plain');
    ugc.recordReceiptLinkRequest(receipt.token);
    const issue = ISSUE_BY_KEY.get(receipt.issue_key);
    if (!issue) return send(res, 404, 'Campaign record unavailable.', 'text/plain');
    const destination = `/c?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}&via=${encodeURIComponent(receipt.action_type)}`;
    res.writeHead(302, { ...SECURITY_HEADERS, Location: destination, 'Cache-Control': 'no-store' });
    return res.end();
  }

  const receiptMatch = u.pathname.match(/^\/receipt\/([a-f0-9]{32})$/);
  if (receiptMatch && req.method === 'GET') {
    const receipt = ugc.getActionReceipt(receiptMatch[1]);
    if (!receipt) return send(res, 404, 'Unknown receipt.', 'text/plain');
    return send(res, 200, renderActionReceipt(receipt), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
  }

  // Consolidation: sidewalk was absorbed into unignorable. Redirect the old host.
  if ((req.headers.host || '').startsWith('sidewalk')) {
    res.writeHead(301, { Location: 'https://unignorable.polyfeeds.dev' + req.url });
    return res.end();
  }

  if (u.pathname === '/api/trends') {
    return sendMaybeGzip(req, res, TRENDS, 'application/json');
  }

  if (u.pathname === '/api/disparity') {
    return sendMaybeGzip(req, res, DISPARITY, 'application/json');
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

  if (u.pathname === '/api/campaign/nearby') {
    const lat = Number(u.searchParams.get('lat')), lng = Number(u.searchParams.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 40.47 || lat > 40.93 || lng < -74.27 || lng > -73.68) {
      return send(res, 400, '{"ok":false,"error":"location must be in New York City"}', 'application/json');
    }
    const items = ISSUES.filter(i => i.status === 'active')
      .map(i => ({ issue: i, distance: distanceMeters(lat, lng, Number(i.lat), Number(i.lng)) }))
      .filter(x => Number.isFinite(x.distance) && x.distance <= 1200)
      .sort((a, b) => a.distance - b.distance || (Number(b.issue.score) || 0) - (Number(a.issue.score) || 0))
      .slice(0, 12)
      .map(({ issue: i, distance }) => ({
        type: i.type, id: i.id, addr: displayLocation(i), borough: titleCase(i.borough),
        reports: Number(i.n) || 0, currentDays: Number(i.current_days) || 0,
        distance: Math.round(distance), campaign: !!ugc.getCampaign(key(i.type, i.id)),
      }));
    return send(res, 200, JSON.stringify({ ok: true, items }), 'application/json');
  }

  if (u.pathname === '/api/campaign/start' && req.method === 'POST') {
    if (rateLimited(req)) return send(res, 429, '{"ok":false,"error":"slow down"}', 'application/json');
    const { type, id, email, confirmed } = await readBody(req);
    const issueKey = key(type, id), issue = ISSUE_BY_KEY.get(issueKey);
    if (!issue || issue.status !== 'active') return send(res, 400, '{"ok":false,"error":"choose an active city record"}', 'application/json');
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return send(res, 400, '{"ok":false,"error":"enter a valid email"}', 'application/json');
    }
    if (confirmed !== true) return send(res, 400, '{"ok":false,"error":"recent firsthand confirmation is required"}', 'application/json');
    const ipHash = crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16);
    const existed = !!ugc.getCampaign(issueKey);
    ugc.startCampaign(issueKey);
    ugc.addCampaignOrganizer(issueKey, cleanEmail, ipHash);
    ugc.addSeen(issueKey, ipHash);
    ISSUES_CACHE = null;
    const url = `${PUBLIC_ORIGIN}/c?t=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
    return send(res, 200, JSON.stringify({ ok: true, existed, url }), 'application/json');
  }

  // Citizen-submitted proof photo, served by id. Filenames are random hex; path-traversal can't escape.
  // design-mock previews for Paul's screenshot laps (basename-safe, html only, noindex)
  if (u.pathname.startsWith('/design/')) {
    const path_ = require('path');
    const name = path_.basename(u.pathname).replace(/[^a-z0-9._-]/gi, '');
    const file = name.endsWith('.html') ? name : name + '.html';
    try {
      const buf = fs.readFileSync(path_.join(__dirname, 'design-mocks', file));
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
      return res.end(buf);
    } catch { return send(res, 404, 'not found', 'text/plain'); }
  }

  if (u.pathname.startsWith('/vendor/')) {
    const name = path.basename(u.pathname);
    const types = { 'leaflet.js': 'text/javascript; charset=utf-8', 'leaflet.css': 'text/css; charset=utf-8' };
    if (!types[name]) return send(res, 404, 'not found', 'text/plain');
    try {
      return send(res, 200, fs.readFileSync(path.join(DIR, 'vendor', name)), types[name], { 'Cache-Control': 'public, max-age=31536000, immutable' });
    } catch { return send(res, 404, 'not found', 'text/plain'); }
  }

  if (u.pathname.startsWith('/photos/')) {
    const name = path.basename(u.pathname);
    const ext = name.split('.').pop();
    if (!MIME[ext]) return send(res, 404, 'not found', 'text/plain');
    try {
      const buf = fs.readFileSync(path.join(PHOTO_DIR, name));
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[ext], 'Cache-Control': 'public, max-age=31536000, immutable' });
      return res.end(buf);
    } catch { return send(res, 404, 'not found', 'text/plain'); }
  }

  // The map: city-sourced issues + status/pattern summary + live corroboration count.
  // Episodes (the timeline) are omitted here and lazy-loaded per card via /api/episodes.
  if (u.pathname === '/api/issues') {
    const c = issuesPayload();
    const ae = req.headers['accept-encoding'] || '';
    if (/\bgzip\b/.test(ae)) {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip',
        'Vary': 'Accept-Encoding' });
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
    if (!ISSUE_BY_KEY.has(key(t, id))) return send(res, 404, '{"ok":false,"error":"unknown issue"}', 'application/json');
    return send(res, 200, JSON.stringify(ugc.thread(key(t, id))), 'application/json');
  }

  // One-tap corroboration ("I see this often").
  if (u.pathname === '/api/seen' && req.method === 'POST') {
    if (rateLimited(req)) return send(res, 429, '{"ok":false,"error":"slow down"}', 'application/json');
    const { type, id } = await readBody(req);
    const issueKey = key(type, id);
    if (!ISSUE_BY_KEY.has(issueKey)) return send(res, 400, '{"ok":false,"error":"unknown issue"}', 'application/json');
    const ipHash = crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16);
    const t = ugc.addSeen(issueKey, ipHash);
    ISSUES_CACHE = null;
    return send(res, 200, JSON.stringify({ ok: true, ...t }), 'application/json');
  }

  // Full commentary ("Add what you see"): text + optional one-tap status + optional proof photo.
  if (u.pathname === '/api/post' && req.method === 'POST') {
    if (rateLimited(req)) return send(res, 429, '{"ok":false,"error":"slow down"}', 'application/json');
    const { type, id, text, status, photo } = await readBody(req);
    const issueKey = key(type, id);
    if (!ISSUE_BY_KEY.has(issueKey)) return send(res, 400, '{"ok":false,"error":"unknown issue"}', 'application/json');
    const file = photo ? savePhoto(photo) : null;
    if (!text && !status && !file) return send(res, 400, '{"ok":false}', 'application/json');
    const clean = (text || '').toString().slice(0, 500).trim();
    const st = ['still_here', 'worse', 'cleaned', 'gone'].includes(status) ? status : null;
    const t = ugc.addPost(issueKey, 'comment', clean || null, st, file);
    return send(res, 200, JSON.stringify({ ok: true, ...t }), 'application/json');
  }

  // Action tracking — append-only momentum log of citizen actions.
  // Rate-limited (shared 12/5min/IP budget). Rejects unknown/coming/disabled action ids (400).
  // Corroborate logs here for momentum count AND to /api/seen for the corroboration verdict counter —
  // intentional double-count: two different purposes, two different tables. See ugc.js note.
  if (u.pathname === '/api/action/confirm' && req.method === 'POST') {
    if (rateLimited(req)) return send(res, 429, '{"ok":false,"error":"slow down"}', 'application/json');
    const { token } = await readBody(req);
    if (!/^[a-f0-9]{32}$/.test(String(token || ''))) return send(res, 400, '{"ok":false,"error":"bad receipt"}', 'application/json');
    const existing = ugc.getActionReceipt(token);
    if (!existing) return send(res, 404, '{"ok":false,"error":"unknown receipt"}', 'application/json');
    const confirmed = ugc.confirmActionReceipt(token);
    if (confirmed.changed) {
      const ipHash = crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16);
      ugc.logAction(existing.issue_key, existing.action_type, ipHash);
    }
    return send(res, 200, JSON.stringify({ ok: true, receipt: confirmed.receipt }), 'application/json', { 'Cache-Control': 'no-store' });
  }

  if (u.pathname === '/api/action/prepare' && req.method === 'POST') {
    if (rateLimited(req)) return send(res, 429, '{"ok":false,"error":"slow down"}', 'application/json');
    const { action_type, type, id } = await readBody(req);
    if (!['email_official', 'share_card'].includes(action_type)) {
      return send(res, 400, '{"ok":false,"error":"unsupported prepared action"}', 'application/json');
    }
    const issueKey = key(type, id), issue = ISSUE_BY_KEY.get(issueKey);
    if (!issue) return send(res, 400, '{"ok":false,"error":"unknown issue"}', 'application/json');
    const official = councilFor(issue.council);
    const target = action_type === 'email_official'
      ? ((official && official.verified && official.email) ? official.email : CAU_EMAIL)
      : ((official && official.x) ? `@${official.x.replace(/^@/, '')}` : '@NYCCouncil');
    const ipHash = crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16);
    const receipt = ugc.createActionReceipt(issueKey, action_type, target, ipHash);
    const trackedUrl = `${PUBLIC_ORIGIN}/r/${receipt.token}`;
    const href = action_type === 'email_official'
      ? buildEmailOfficialUrl(issue, ugc.getCampaign(issueKey), trackedUrl)
      : buildShareUrl(issue, trackedUrl).tweetUrl;
    ugc.logAction(issueKey, `${action_type}_prepared`, ipHash);
    const receiptUrl = `${PUBLIC_ORIGIN}/receipt/${receipt.token}`;
    return send(res, 200, JSON.stringify({ ok: true, href, receipt: receipt.token, receiptUrl }), 'application/json', { 'Cache-Control': 'no-store' });
  }

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

  // --- AREA (zone) share: mint one permalink for a framed cluster of issue-cells ---
  if (u.pathname === '/api/area' && req.method === 'POST') {
    if (rateLimited(req)) return send(res, 429, '{"ok":false,"error":"slow down"}', 'application/json');
    const body = await readBody(req);
    const b = body.bbox || {};
    const s = +b.s, w = +b.w, nn = +b.n, e = +b.e;
    if (![s, w, nn, e].every(Number.isFinite) || s >= nn || w >= e) {
      return send(res, 400, '{"ok":false,"error":"bad bbox"}', 'application/json');
    }
    const known = Object.keys(AREA_TYPE_COLORS);
    const reqTypes = Array.isArray(body.types) ? body.types.filter(t => known.includes(t)) : [];
    const useTypes = (reqTypes.length ? reqTypes : known).slice().sort();
    const includeResolved = !!body.resolved;
    let members = ISSUES.filter(i =>
      i.lat >= s && i.lat <= nn && i.lng >= w && i.lng <= e &&
      useTypes.includes(i.type) &&
      (i.status === 'active' || (includeResolved && i.status === 'resolved')));
    if (!members.length) return send(res, 400, '{"ok":false,"error":"no issues in this area"}', 'application/json');
    // A zone is a cluster, not the whole city — keep the worst-scoring MAX if over the cap.
    if (members.length > AREA_MAX_MEMBERS) {
      members = members.slice().sort((a, c) => (Number(c.score) || 0) - (Number(a.score) || 0)).slice(0, AREA_MAX_MEMBERS);
    }
    const memberKeys = members.map(i => key(i.type, i.id));
    const st = areaStats(members);
    const snapshot = { spots: st.spots, n: st.n, closed: st.closed, nf: st.nf,
      activeSpots: st.activeSpots, boroughs: st.boroughs,
      anchor: titleCase(st.worst && st.worst.addr) || null };
    const title = areaTitle(st);
    const r4 = (x) => Math.round(x * 1e4) / 1e4;
    const fp = crypto.createHash('sha1')
      .update([r4(s), r4(w), r4(nn), r4(e)].join(',') + '|' + useTypes.join(',') + '|' + (includeResolved ? 'r' : ''))
      .digest('hex').slice(0, 16);
    let row;
    try {
      row = ugc.createArea({ fingerprint: fp, bbox: { s, w, n: nn, e }, types: useTypes, memberKeys, snapshot, title });
    } catch (err) { return send(res, 500, '{"ok":false}', 'application/json'); }
    const url = `${PUBLIC_ORIGIN}/a/${row.id}`;
    return send(res, 200, JSON.stringify({ ok: true, id: row.id, url, title, stats: snapshot,
      tweet: areaTweet(st, url) }), 'application/json');
  }
  if (u.pathname === '/api/area/share' && req.method === 'POST') {
    const { id } = await readBody(req);
    if (id && ugc.getArea(id)) ugc.bumpAreaShare(id);
    return send(res, 200, '{"ok":true}', 'application/json');
  }

  // --- Review queue (Paul's personal gate before anything is public / filed to 311) ---
  if (u.pathname === '/api/review') {
    if (!authed(req, u)) return send(res, 401, '{"ok":false}', 'application/json');
    const items = ugc.pending().map(p => ({ ...p, issue: issueMeta(p.issue_key) }));
    return send(res, 200, JSON.stringify({ ok: true, count: items.length, items }), 'application/json');
  }
  if (u.pathname === '/api/review/decide' && req.method === 'POST') {
    if (!authed(req, u)) return send(res, 401, '{"ok":false}', 'application/json');
    const { id, action } = await readBody(req);
    if (!['approve', 'reject'].includes(action)) return send(res, 400, '{"ok":false}', 'application/json');
    const row = ugc.decide(id, action);
    if (row && action === 'reject' && row.photo) { try { fs.unlinkSync(path.join(PHOTO_DIR, row.photo)); } catch {} }
    return send(res, 200, JSON.stringify({ ok: !!row, count: ugc.pendingCount() }), 'application/json');
  }
  if (u.pathname === '/review') {
    if (!authed(req, u)) return send(res, 401, 'unauthorized', 'text/plain', { 'Cache-Control': 'no-store' });
    if (u.searchParams.has('k')) {
      res.writeHead(303, { ...SECURITY_HEADERS, Location: '/review', 'Cache-Control': 'no-store',
        'Set-Cookie': `unig_review=${encodeURIComponent(REVIEW_KEY)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000` });
      return res.end();
    }
    return send(res, 200, fs.readFileSync(path.join(DIR, 'review.html')), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
  }

  if (u.pathname === '/robots.txt') return send(res, 200, ROBOTS, 'text/plain');
  if (u.pathname === '/sitemap.xml') return send(res, 200, SITEMAP, 'application/xml');

  // The standing-zones index (auto hotspots, worst first).
  if (u.pathname === '/hotspots') {
    return send(res, 200, renderHotspotsIndex(), 'text/html; charset=utf-8');
  }

  // The AREA (zone) page: /a/<id> — a user-minted bundle (hex id) OR an auto hotspot (slug).
  if (u.pathname.startsWith('/a/')) {
    const id = u.pathname.slice(3).replace(/[^a-z0-9-]/gi, '').toLowerCase();
    if (!id || !ugc.getArea(id)) return send(res, 404, 'No such area.', 'text/plain');
    try { ugc.bumpAreaView(id); } catch {}
    const area = ugc.getArea(id); // re-read so this view is reflected in the counter
    return send(res, 200, renderArea(area), 'text/html; charset=utf-8');
  }

  if (u.pathname === '/start') {
    const t = u.searchParams.get('t') || u.searchParams.get('type');
    const id = u.searchParams.get('id');
    const selected = t && id ? ISSUE_BY_KEY.get(key(t, id)) : null;
    return send(res, 200, renderCampaignStart(selected), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
  }

  // The CAMPAIGN PAGE: /i, /issue, /c, /campaign all render the same surface.
  if (u.pathname === '/i' || u.pathname === '/issue' || u.pathname === '/c' || u.pathname === '/campaign') {
    const t = u.searchParams.get('t') || u.searchParams.get('type');
    const id = u.searchParams.get('id');
    const issue = ISSUES.find(i => i.type === t && i.id === id);
    if (!issue) return send(res, 404, 'No such record.', 'text/plain');
    return send(res, 200, renderCampaign(issue), 'text/html; charset=utf-8');
  }

  // Launch front door: Campaign 001 proves the playbook. The citywide map remains the discovery
  // surface, and every campaign carries a self-service path for another resident to start one.
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(302, { ...SECURITY_HEADERS, Location: CANARY_URL, 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (u.pathname === '/map') {
    return send(res, 200, fs.readFileSync(path.join(DIR, 'index.html')), 'text/html; charset=utf-8');
  }

  send(res, 404, 'not found', 'text/plain');
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    const code = err && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    console.error(JSON.stringify({ level: 'error', method: req.method, url: req.url, code, error: err && err.message }));
    if (!res.headersSent) send(res, code, JSON.stringify({ ok: false, error: code === 500 ? 'internal error' : err.message }), 'application/json');
    else res.end();
  });
});

server.listen(PORT, () => {
  console.log(`unignorable on :${PORT} — ${ISSUES.length} issues`);
  console.log('review queue ready');
});

function shutdown(signal) {
  console.log(`${signal}: closing HTTP server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
