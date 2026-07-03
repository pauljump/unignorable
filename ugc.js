// UGC store — citizen reports + corroboration on top of the city's 311 issues.
// Built-in node:sqlite (zero npm deps). The citizen layer that overrides the city's "resolved".
//
// Moderation model (Paul reviews personally — the gate before we file to 311 on a citizen's behalf):
//   • a REPORT (kind='comment' — photo and/or written description) lands `mod='pending'`,
//     invisible to the public until Paul approves it in the review queue.
//   • a TAP (kind='seen' — "I see this often") is live corroboration, not a 311 filing, so `mod='approved'`.
// Public read paths (thread/counts/verdict) only ever reflect mod='approved'.
//
// Campaign layer (§2 of the campaign contract):
//   • `campaigns` table tracks one active campaign per issue_key.
//   • `actions` table is an append-only momentum log of citizen actions (email, share, etc.).
//     INTENTIONAL DOUBLE-COUNT NOTE: corroborate logs to BOTH /api/seen (corroboration verdict
//     counter, kind='seen' in posts) AND /api/act with action_type='corroborate' (momentum feed
//     counter in actions). These are two different counters serving different purposes — do not
//     merge or deduplicate them.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const db = new DatabaseSync(path.join(__dirname, 'data', 'ugc.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS posts(
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_key TEXT NOT NULL,
    ts        TEXT NOT NULL,
    kind      TEXT NOT NULL,   -- 'seen' (one-tap corroboration) | 'comment' (a report)
    text      TEXT,
    status    TEXT,            -- 'still_here' | 'worse' | 'cleaned' | 'gone' | NULL
    photo     TEXT,            -- filename in data/photos/, or NULL. The proof 311 can't have.
    mod       TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'approved' | 'rejected'
  );
  CREATE INDEX IF NOT EXISTS idx_posts_issue ON posts(issue_key);
`);
// Migrate older DBs lacking newer columns — must precede any index on those columns.
const cols = db.prepare(`PRAGMA table_info(posts)`).all().map(c => c.name);
if (!cols.includes('photo')) db.exec(`ALTER TABLE posts ADD COLUMN photo TEXT`);
if (!cols.includes('mod'))   db.exec(`ALTER TABLE posts ADD COLUMN mod TEXT NOT NULL DEFAULT 'pending'`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_mod ON posts(mod)`);

// ---- Campaign table ----
// Day-N is NOT stored here — it derives at render from the issue's current episode start.
// started_at is when THIS campaign was created (used for escalation ladder age).
db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns(
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_key  TEXT NOT NULL UNIQUE,
    started_at TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active',
    won_at     TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_key ON campaigns(issue_key);
`);
// Forward migration: add won_at if missing on older DBs.
{
  const campCols = db.prepare(`PRAGMA table_info(campaigns)`).all().map(c => c.name);
  if (!campCols.includes('won_at')) db.exec(`ALTER TABLE campaigns ADD COLUMN won_at TEXT`);
}

// ---- Actions table (append-only momentum log) ----
db.exec(`
  CREATE TABLE IF NOT EXISTS actions(
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_key   TEXT NOT NULL,
    action_type TEXT NOT NULL,
    ts          TEXT NOT NULL,
    ip_hash     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_actions_issue ON actions(issue_key);
  CREATE INDEX IF NOT EXISTS idx_actions_ts ON actions(ts);
`);
// Forward migration: add ip_hash if missing on older DBs.
{
  const actCols = db.prepare(`PRAGMA table_info(actions)`).all().map(c => c.name);
  if (!actCols.includes('ip_hash')) db.exec(`ALTER TABLE actions ADD COLUMN ip_hash TEXT`);
}

// Campaign prepared statements.
const qCampInsert   = db.prepare(`INSERT OR IGNORE INTO campaigns(issue_key,started_at,status) VALUES(?,?,?)`);
const qCampGet      = db.prepare(`SELECT * FROM campaigns WHERE issue_key=?`);
const qCampSetStatus = db.prepare(`UPDATE campaigns SET status=?, won_at=? WHERE issue_key=?`);
const qCampAll      = db.prepare(`SELECT * FROM campaigns`);

// Action prepared statements.
const qActInsert    = db.prepare(`INSERT INTO actions(issue_key,action_type,ts,ip_hash) VALUES(?,?,?,?)`);
const qActByIssue   = db.prepare(`SELECT action_type, ts FROM actions WHERE issue_key=? ORDER BY id ASC`);
const qActHas       = db.prepare(`SELECT 1 FROM actions WHERE issue_key=? AND action_type=? LIMIT 1`);
const qActFirst     = db.prepare(`SELECT ts FROM actions WHERE issue_key=? AND action_type=? ORDER BY id ASC LIMIT 1`);

const qInsert  = db.prepare(`INSERT INTO posts(issue_key,ts,kind,text,status,photo,mod) VALUES(?,?,?,?,?,?,?)`);
const qByIssue = db.prepare(`SELECT id,ts,kind,text,status,photo FROM posts WHERE issue_key=? AND mod='approved' ORDER BY id DESC LIMIT 80`);
const qCounts  = db.prepare(`
  SELECT issue_key,
         SUM(CASE WHEN kind='seen' OR status IN('still_here','worse') THEN 1 ELSE 0 END) AS corrob
  FROM posts WHERE mod='approved' GROUP BY issue_key`);
// Review queue — Paul's personal gate. Oldest first (FIFO triage).
const qPending = db.prepare(`SELECT id,issue_key,ts,kind,text,status,photo FROM posts WHERE mod='pending' ORDER BY id ASC LIMIT 300`);
const qPendCount = db.prepare(`SELECT COUNT(*) AS n FROM posts WHERE mod='pending'`);
const qGetOne  = db.prepare(`SELECT id,issue_key,photo,mod FROM posts WHERE id=?`);
const qSetMod  = db.prepare(`UPDATE posts SET mod=? WHERE id=?`);

// Verdict from the crowd — the citizen verdict is the truth (city "closed" is only a claim).
function verdictOf(posts) {
  const withStatus = posts.filter(p => p.status);          // posts are newest-first
  const latest = withStatus[0];
  const corrob = posts.filter(p => p.kind === 'seen' || p.status === 'still_here' || p.status === 'worse').length;
  if (latest && (latest.status === 'gone' || latest.status === 'cleaned')) return 'cleared';
  if (latest || corrob > 0) return 'still_here';
  return 'unverified';
}

function thread(issueKey) {
  const posts = qByIssue.all(issueKey);
  const corrob = posts.filter(p => p.kind === 'seen' || p.status === 'still_here' || p.status === 'worse').length;
  return {
    posts: posts.filter(p => p.kind === 'comment'),        // commentary stream for the thread UI
    verdict: verdictOf(posts),
    corrob,
    lastTs: posts.length ? posts[0].ts : null,
  };
}

function addPost(issueKey, kind, text, status, photo) {
  const mod = kind === 'seen' ? 'approved' : 'pending';    // taps live; reports wait for Paul
  qInsert.run(issueKey, new Date().toISOString(), kind, text || null, status || null, photo || null, mod);
  return { ...thread(issueKey), pending: mod === 'pending' };
}

function countsAll() {
  const m = {};
  for (const r of qCounts.all()) m[r.issue_key] = r.corrob;
  return m;
}

// --- Review queue (Paul's gate) ---
function pending()      { return qPending.all(); }
function pendingCount() { return qPendCount.get().n; }
// Returns the affected row (incl. photo filename) so the server can clean up files on reject.
function decide(id, action) {
  const row = qGetOne.get(id);
  if (!row || row.mod !== 'pending') return null;
  qSetMod.run(action === 'approve' ? 'approved' : 'rejected', id);
  return row;
}

// ---- Campaign functions ----

// Idempotent: INSERT OR IGNORE; returns the row (existing or newly created).
function startCampaign(issueKey) {
  qCampInsert.run(issueKey, new Date().toISOString(), 'active');
  return qCampGet.get(issueKey);
}

function getCampaign(issueKey) {
  return qCampGet.get(issueKey) || null;
}

function setCampaignStatus(issueKey, status, wonAt) {
  qCampSetStatus.run(status, wonAt || null, issueKey);
}

function allCampaigns() {
  return qCampAll.all();
}

// ---- Action functions ----

function logAction(issueKey, actionType, ipHash) {
  qActInsert.run(issueKey, actionType, new Date().toISOString(), ipHash || null);
}

// Returns { total, byType: { <action_type>: N }, thisWeek: { total, byType } }
// thisWeek = rows whose ts is within the last 7 * 86400000 ms.
function actionCounts(issueKey) {
  const rows = qActByIssue.all(issueKey);
  const weekCutoff = Date.now() - 7 * 86400000;
  const byType = {};
  const thisWeekByType = {};
  let thisWeekTotal = 0;
  for (const r of rows) {
    byType[r.action_type] = (byType[r.action_type] || 0) + 1;
    const t = Date.parse(r.ts);
    if (Number.isFinite(t) && t >= weekCutoff) {
      thisWeekByType[r.action_type] = (thisWeekByType[r.action_type] || 0) + 1;
      thisWeekTotal++;
    }
  }
  return { total: rows.length, byType, thisWeek: { total: thisWeekTotal, byType: thisWeekByType } };
}

// Returns true if any row exists for this issue+action combo.
function hasAction(issueKey, actionType) {
  return !!qActHas.get(issueKey, actionType);
}

// Returns the ISO8601 ts of the first logged action of this type for this issue, or null.
function firstActionTs(issueKey, actionType) {
  const r = qActFirst.get(issueKey, actionType);
  return r ? r.ts : null;
}

module.exports = { addPost, thread, countsAll, pending, pendingCount, decide,
  startCampaign, getCampaign, setCampaignStatus, allCampaigns,
  logAction, actionCounts, hasAction, firstActionTs };
