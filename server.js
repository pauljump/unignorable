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

// Accountable-officials roster (council district → member + contact + X handle, Mayor's CAU).
// Optional: the receipt page degrades to "district N + look-up link" if the file isn't present yet.
let OFFICIALS = { council: {}, cau: null, borough_presidents: {} };
try { OFFICIALS = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'officials.json'), 'utf8')); } catch {}
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || 'https://unignorable.polyfeeds.dev';

// Photo store — the proof layer 311 open data structurally can't have. Bytes on disk, served by id.
const PHOTO_DIR = path.join(DIR, 'data', 'photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PHOTO_MAX = 2_000_000;  // ~2MB of decoded bytes; the client downscales to ~1280px JPEG (≪ this)

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
// Cache the (large, static-ish) issues payload + its gzip, keyed on a cheap signature of the
// dynamic `seen` counts. Counts change only when an approved report lands, so this is a near-static
// blob most of the time — we avoid re-serializing AND re-gzipping 6 MB on every request.
let ISSUES_CACHE = null; // { sig, raw:Buffer, gz:Buffer }
function issuesPayload() {
  const counts = ugc.countsAll();
  const sig = JSON.stringify(counts);
  if (ISSUES_CACHE && ISSUES_CACHE.sig === sig) return ISSUES_CACHE;
  const out = ISSUES.map(({ episodes, headline_kind, nothing_found, ...i }) =>
    ({ ...i, seen: counts[key(i.type, i.id)] || 0 }));
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

// Resolve the accountable council member from the issue's (zero-padded) district code.
function councilFor(council) {
  const n = parseInt(String(council || '').match(/\d+/)?.[0] || '', 10);
  if (!Number.isFinite(n)) return null;
  const m = OFFICIALS.council && OFFICIALS.council[String(n)];
  return m ? { district: n, ...m } : { district: n };
}

// Inline-SVG episode timeline: each continuous run of reports as a band on a first-seen→today axis.
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
    rule: 'It is unlawful to erect a shed, structure, or other obstruction — or to leave movable property — upon any public street or sidewalk.',
    penalty: 'Fine of $50–$250, up to 10 days’ imprisonment, or both — per offense.',
    also: 'Blocking the pedestrian right-of-way is separately prohibited under § 19-136.',
    src: 'https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-26202',
  },
};

function renderReceipt(issue) {
  const addr = titleCase(issue.addr) || 'this location';
  const boro = titleCase(issue.borough);
  const area = boro ? `${addr}, ${boro}` : addr;
  const known = daysSince(issue.first_seen);
  const nf = Number(issue.nothing_found) || 0;
  const cn = Number(issue.closed_n) || 0;
  const rn = Number(issue.returned_n) || 0;
  const ard = (issue.avg_return_days != null && Number.isFinite(issue.avg_return_days)) ? issue.avg_return_days : null;
  const m = councilFor(issue.council);
  const verified = !!(m && m.member && m.verified); // gates name display + indexing
  const law = LAW[issue.type];
  const cau = OFFICIALS.cau;
  const shareUrl = `${PUBLIC_ORIGIN}/i?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`;
  const mapUrl = `${PUBLIC_ORIGIN}/map?focus=${encodeURIComponent(issue.type + '|' + issue.id)}`;

  // The damning one-liner (title/OG) — derived, factual, sourced to the record.
  const ogTitle = known != null
    ? `The city has known about ${addr} for ${fmtN(known)} days.`
    : `${addr} — the city's own record.`;
  const ogDesc = `${issue.type} reported ${fmtN(issue.n)}× to NYC 311`
    + (nf ? `, closed "nothing found" ${fmtN(nf)}×` : '')
    + (issue.status === 'active' ? '. Still here.' : '.')
    + (verified ? ` Accountable: Council Member ${m.member}.` : '');

  // Public-pressure tweet, pre-filled, tagging the official if we have a handle.
  const tag = (m && m.x) ? `@${m.x.replace(/^@/, '')} ` : '';
  const tweet = `${tag}${addr}: reported ${fmtN(issue.n)}× to NYC 311, closed "nothing found" ${fmtN(nf)}×. `
    + (issue.status === 'active' ? `Still here after ${fmtN(known)} days. ` : '')
    + `Clear the sidewalk AND connect these neighbors to services. Your move.`;
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(shareUrl)}`;

  const stat = (big, label, alarm) =>
    `<div class="stat"><div class="big ${alarm ? 'alarm' : ''}">${big}</div><div class="lbl">${label}</div></div>`;

  // Accountable-official card. Names the office-holder + how to reach them. Falls back to a lookup link.
  // The NAME is shown (and the page made indexable) ONLY when the member is `verified` — so public
  // indexing can never surface an unconfirmed name. Verification is the gate, by construction.
  let officialBlock;
  if (verified) {
    const contacts = [
      m.x ? `<a href="https://twitter.com/${esc(m.x.replace(/^@/, ''))}">@${esc(m.x.replace(/^@/, ''))}</a>` : '',
      m.phone ? esc(m.phone) : '',
      m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : '',
    ].filter(Boolean).join(' · ');
    officialBlock = `<div class="who-name">${esc(m.member)}</div>`
      + `<div class="who-role">NYC Council Member, District ${m.district}${m.borough ? ' · ' + esc(m.borough) : ''}</div>`
      + (contacts ? `<div class="who-contact">${contacts}</div>` : '')
      + `<div class="who-now">Represents this block today. ${issue.status === 'active'
          ? 'It is still here on their watch — and within their power to move DHS, Sanitation, and NYPD on it now.'
          : 'The record is theirs to answer for.'}</div>`;
  } else {
    const dn = m && m.district ? m.district : (issue.council || '—');
    officialBlock = `<div class="who-name">Council District ${esc(dn)}</div>`
      + `<div class="who-contact"><a href="https://council.nyc.gov/districts/">Find &amp; name the member →</a></div>`;
  }

  const stamp = `Built from New York City's own 311 open data (dataset erm2-nwe9)`
    + (issue.last_seen ? `, current through ${esc(issue.last_seen)}` : '') + '.';

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="${verified ? 'index,follow' : 'noindex'}">
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
</style></head><body><div class="wrap">
  <div class="mast"><a class="word" href="${esc(PUBLIC_ORIGIN)}/map">UN<b>IGNOR</b>ABLE</a><span class="tag">a public receipt</span></div>

  <div class="kicker">${esc(issue.type)} · ${esc(area)}</div>
  <h1>${esc(ogTitle)}</h1>
  <p class="sub">${issue.status === 'active' ? 'Still active.' : 'On the record.'} ${verified ? 'The official responsible is named below.' : ''}</p>

  ${known != null ? `<div class="clock"><div class="n">${fmtN(known)} days</div><div class="c">since the first 311 report at this spot — ${esc(issue.first_seen)}${fmtYears(known) ? ' (' + fmtYears(known) + ')' : ''}</div></div>` : ''}

  <div class="headline">${esc(issue.headline || '')}</div>

  <div class="grid">
    ${stat(fmtN(issue.n), 'times reported to 311', true)}
    ${stat(fmtN(cn), 'closed by the city')}
    ${stat(fmtN(nf), '“nothing found” closures', true)}
    ${stat(fmtN(rn), 'came back after closing', true)}
    ${stat(ard != null ? ard.toFixed(1) + 'd' : '—', 'avg. before it returned')}
    ${stat(fmtN(issue.episode_count), 'separate flare-ups')}
  </div>

  <div class="spark"><div class="cap">every red band = a stretch the city was getting reports and closing them. ${esc(issue.first_seen)} → today.</div>${sparkline(issue)}</div>

  <h2>Who is accountable</h2>
  <div class="card">
    ${officialBlock}
    <div class="who-verdict">What the record shows: the city closed this <b>${fmtN(cn)} times</b>${nf ? ` — ${fmtN(nf)} of them as “nothing found”` : ''}. What changed on the block: <b>${issue.status === 'active' ? 'nothing — it’s still here' : 'it kept coming back'}</b>. Responding agency on the tickets: ${esc(issue.agency || 'NYC')}.</div>
  </div>

  ${law ? `<h2>What the law says</h2>
  <div class="card law">
    <div class="law-code">${esc(law.code)}</div>
    <div class="law-rule">${esc(law.rule)}</div>
    <div class="law-pen"><span>Penalty</span> ${esc(law.penalty)}</div>
    <div class="law-also">${esc(law.also)} · <a href="${esc(law.src)}">read the statute →</a></div>
  </div>` : ''}

  <h2>What we are asking for</h2>
  <div class="card ask"><ul style="margin:0;padding-left:18px">
    <li><b>Clear the sidewalk.</b> A persistent street obstruction blocks the public right-of-way (NYC Admin Code §16-122 / §19-136). The city has clear authority to act.</li>
    <li><b>Connect these neighbors to services.</b> File this as an outreach request to DHS so the people here are offered shelter and help — clearing without serving just moves the problem.</li>
    <li><b>Make it stick.</b> When the city last did this right (Sheepshead Bay), it cleared the site <i>and</i> prevented its return. Closing a ticket is not fixing the problem.</li>
  </ul></div>

  <div class="actions">
    <a class="btn x" href="${esc(tweetUrl)}">Name them publicly →</a>
    <a class="btn ghost" href="${esc(mapUrl)}">See it on the map</a>
  </div>
  <div class="fine">Posting this tags the responsible office with the city’s own numbers. That’s the point.</div>

  <div class="stamp">${stamp}<br>This page documents a <b>government’s</b> response to a public-safety obstruction. It is not about, and does not identify, any individual experiencing homelessness — they are failed by this inaction, not the cause of it.</div>
</div></body></html>`;
}

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

  // The RECEIPT: a public, named, dated accountability page for one Issue (/i?t=…&id=…).
  if (u.pathname === '/i' || u.pathname === '/issue') {
    const t = u.searchParams.get('t') || u.searchParams.get('type');
    const id = u.searchParams.get('id');
    const issue = ISSUES.find(i => i.type === t && i.id === id);
    if (!issue) return send(res, 404, 'No such record.', 'text/plain');
    return send(res, 200, renderReceipt(issue), 'text/html; charset=utf-8');
  }

  // The landing ("The Record") and the live map are ONE document: index.html decides what to
  // render from location (hash / query). /map is the map-first entry (deep-links target it);
  // / is the shame-board landing. Same file → one /api/issues fetch, every map fn reused.
  if (u.pathname === '/' || u.pathname === '/index.html' || u.pathname === '/map') {
    return send(res, 200, fs.readFileSync(path.join(DIR, 'index.html')), 'text/html; charset=utf-8');
  }

  send(res, 404, 'not found', 'text/plain');
});

server.listen(PORT, () => {
  console.log(`unignorable on :${PORT} — ${ISSUES.length} issues`);
  console.log(`review queue → /review?k=${REVIEW_KEY}`);
});
