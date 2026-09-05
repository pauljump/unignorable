'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const CATEGORIES = ['route', 'data', 'idea', 'bug'];
const STATUSES = ['new', 'reviewing', 'planned', 'shipped', 'closed'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function createFeedbackStore(directory) {
  const db = new DatabaseSync(path.join(directory, 'feedback.db'));
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, platform TEXT NOT NULL, category TEXT NOT NULL,
    usefulness TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', reply TEXT NOT NULL DEFAULT '');`);
  const prune = () => db.prepare("DELETE FROM feedback WHERE created_at < ?").run(new Date(Date.now()-90*86400000).toISOString());
  prune();
  return {
    submit(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['platform','category','usefulness','message'].includes(k))
        || !['web','ios'].includes(body.platform) || !CATEGORIES.includes(body.category)
        || !['yes','partly','no','not_yet'].includes(body.usefulness)
        || typeof body.message !== 'string' || body.message.trim().length < 3 || body.message.length > 2000) {
        throw Object.assign(new Error('Choose a topic and add 3–2,000 characters of feedback.'), { statusCode: 400 });
      }
      prune();
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO feedback (id,created_at,platform,category,usefulness,message) VALUES (?,?,?,?,?,?)')
        .run(id,new Date().toISOString(),body.platform,body.category,body.usefulness,body.message.trim());
      return { ok:true, id, status:'new' };
    },
    receipt(id) { prune(); return db.prepare('SELECT id,status,reply FROM feedback WHERE id=?').get(id); },
    list() { prune(); return db.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 200').all(); },
    update(body) {
      if (!body || !STATUSES.includes(body.status) || typeof body.reply !== 'string' || body.reply.length > 2000) throw Object.assign(new Error('Invalid feedback update.'),{statusCode:400});
      return db.prepare('UPDATE feedback SET status=?,reply=? WHERE id=?').run(body.status,body.reply.trim(),String(body.id)).changes > 0;
    }, close() { db.close(); }
  };
}
const page = (title, content) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><title>${title} · Unignorable</title><link rel="stylesheet" href="/launch.css"><body class="launch-page"><main><a href="/">← Unignorable</a>${content}</main></body></html>`;
function reviewPage(rows) {
  return page('Feedback inbox', `<h1>Feedback inbox</h1><p>Latest 200 submissions · retained for 90 days. Replies are visible to the person with the receipt link. No email is sent.</p>${rows.map(row => `<article><small>${escape(row.created_at)} · ${escape(row.platform)} · ${escape(row.category)} · useful: ${escape(row.usefulness)}</small><p class="feedback-message">${escape(row.message)}</p><form data-review-id="${escape(row.id)}"><label>Status<select name="status">${STATUSES.map(s=>`<option ${s===row.status?'selected':''}>${s}</option>`).join('')}</select></label><label>Reply<textarea name="reply" maxlength="2000">${escape(row.reply)}</textarea></label><button>Save update</button><p role="status"></p></form></article>`).join('') || '<p>No feedback yet.</p>'}<script src="/feedback-client.js" defer></script>`);
}
function createFeedbackHandler(directory) {
  const store = createFeedbackStore(directory);
  return async function handle({req,res,u,send,readBody,authed,rateLimited,origin}) {
    const json = (code, value) => send(res,code,JSON.stringify(value),'application/json',{'Cache-Control':'no-store'});
    if (['/launch.css','/launch-client.js','/feedback-client.js'].includes(u.pathname) && req.method==='GET') {
      send(res,200,fs.readFileSync(path.join(__dirname,u.pathname.slice(1))),u.pathname.endsWith('.css')?'text/css':'text/javascript');return true;
    }
    if (['/feedback','/privacy','/support'].includes(u.pathname) && req.method==='GET') {
      send(res,200,fs.readFileSync(path.join(__dirname,u.pathname==='/feedback'?'feedback.html':u.pathname==='/privacy'?'privacy.html':'support.html')),'text/html; charset=utf-8');return true;
    }
    if (u.pathname==='/feedback/review' && req.method==='GET') {
      if (!authed(req,u)) { send(res,401,'Open /review and sign in before opening the feedback inbox.','text/plain');return true; }
      send(res,200,reviewPage(store.list()),'text/html; charset=utf-8',{'Cache-Control':'no-store'});return true;
    }
    if (!u.pathname.startsWith('/api/feedback')) return false;
    if (req.method==='POST') {
      if ((req.headers.origin && req.headers.origin!==origin) || req.headers['sec-fetch-site']==='cross-site' || !/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) {json(403,{error:'Use the feedback form in Unignorable.'});return true;}
      if (rateLimited(req)) {json(429,{error:'Too many submissions. Please try later.'});return true;}
      const body=await readBody(req);
      if (u.pathname==='/api/feedback') {json(201,store.submit(body));return true;}
      if (u.pathname==='/api/feedback/review') {
        if (!authed(req,u)) {json(401,{error:'Sign in to review feedback.'});return true;}
        const updated=store.update(body);json(updated?200:404,updated?{ok:true}:{error:'Receipt not found.'});return true;
      }
    }
    if (req.method==='GET' && /^\/api\/feedback\/[a-f0-9-]{36}$/.test(u.pathname)) {
      const receipt=store.receipt(u.pathname.split('/').pop());json(receipt?200:404,receipt||{error:'Receipt not found or expired.'});return true;
    }
    json(404,{error:'Not found.'});return true;
  };
}
module.exports={createFeedbackStore,createFeedbackHandler,reviewPage};
