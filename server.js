// unignorable — zero-dep civic accountability map.
// City 311 data is the BAIT (their self-serving "resolved 100x"); citizen commentary is the TRUTH.
const http = require('http');
const fs = require('fs');
const path = require('path');
const ugc = require('./ugc');

const DIR = __dirname;
const PORT = process.env.PORT || 8000;
const ISSUES = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'issues.json'), 'utf8'));
const TRENDS = fs.readFileSync(path.join(DIR, 'data', 'trends.json'));

const key = (type, id) => type + '|' + id;
const send = (res, code, body, type) => {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
};
const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');

  // Consolidation: sidewalk was absorbed into unignorable. Redirect the old host.
  if ((req.headers.host || '').startsWith('sidewalk')) {
    res.writeHead(301, { Location: 'https://unignorable.polyfeeds.dev' + req.url });
    return res.end();
  }

  if (u.pathname === '/api/trends') {
    return send(res, 200, TRENDS, 'application/json');
  }

  // The map: city-sourced issues + status/pattern summary + live corroboration count.
  // Episodes (the timeline) are omitted here and lazy-loaded per card via /api/episodes.
  if (u.pathname === '/api/issues') {
    const counts = ugc.countsAll();
    const out = ISSUES.map(({ episodes, ...i }) => ({ ...i, seen: counts[key(i.type, i.id)] || 0 }));
    return send(res, 200, JSON.stringify(out), 'application/json');
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
    const { type, id } = await readBody(req);
    if (!type || !id) return send(res, 400, '{"ok":false}', 'application/json');
    const t = ugc.addPost(key(type, id), 'seen', null, 'still_here');
    return send(res, 200, JSON.stringify({ ok: true, ...t }), 'application/json');
  }

  // Full commentary ("Add what you see"): text + optional one-tap status.
  if (u.pathname === '/api/post' && req.method === 'POST') {
    const { type, id, text, status } = await readBody(req);
    if (!type || !id || (!text && !status)) return send(res, 400, '{"ok":false}', 'application/json');
    const clean = (text || '').toString().slice(0, 500).trim();
    const st = ['still_here', 'worse', 'cleaned', 'gone'].includes(status) ? status : null;
    const t = ugc.addPost(key(type, id), 'comment', clean || null, st);
    return send(res, 200, JSON.stringify({ ok: true, ...t }), 'application/json');
  }

  if (u.pathname === '/' || u.pathname === '/index.html') {
    return send(res, 200, fs.readFileSync(path.join(DIR, 'index.html')), 'text/html; charset=utf-8');
  }

  send(res, 404, 'not found', 'text/plain');
});

server.listen(PORT, () => console.log(`unignorable on :${PORT} — ${ISSUES.length} issues`));
