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
