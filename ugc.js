// UGC store — citizen reports + corroboration on top of the city's 311 issues.
// Built-in node:sqlite (zero npm deps). The citizen layer that overrides the city's "resolved".
//
// Moderation model (Paul reviews personally — the gate before we file to 311 on a citizen's behalf):
//   • a REPORT (kind='comment' — photo and/or written description) lands `mod='pending'`,
//     invisible to the public until Paul approves it in the review queue.
//   • a TAP (kind='seen' — "I see this often") is live corroboration, not a 311 filing, so `mod='approved'`.
// Public read paths (thread/counts/verdict) only ever reflect mod='approved'.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

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

module.exports = { addPost, thread, countsAll, pending, pendingCount, decide };
