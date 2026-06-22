// UGC store — citizen commentary + status on top of the city's 311 issues.
// Built-in node:sqlite (zero npm deps). The citizen layer that overrides the city's "resolved".
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'data', 'ugc.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS posts(
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_key TEXT NOT NULL,
    ts        TEXT NOT NULL,
    kind      TEXT NOT NULL,   -- 'seen' (one-tap corroboration) | 'comment'
    text      TEXT,
    status    TEXT,            -- 'still_here' | 'worse' | 'cleaned' | 'gone' | NULL
    photo     TEXT             -- filename in data/photos/, or NULL. The proof 311 can't have.
  );
  CREATE INDEX IF NOT EXISTS idx_posts_issue ON posts(issue_key);
`);
// Migrate older DBs that predate the photo column (the proof layer).
if (!db.prepare(`PRAGMA table_info(posts)`).all().some(c => c.name === 'photo')) {
  db.exec(`ALTER TABLE posts ADD COLUMN photo TEXT`);
}

const qInsert   = db.prepare(`INSERT INTO posts(issue_key,ts,kind,text,status,photo) VALUES(?,?,?,?,?,?)`);
const qByIssue  = db.prepare(`SELECT id,ts,kind,text,status,photo FROM posts WHERE issue_key=? ORDER BY id DESC LIMIT 80`);
const qCounts   = db.prepare(`
  SELECT issue_key,
         SUM(CASE WHEN kind='seen' OR status IN('still_here','worse') THEN 1 ELSE 0 END) AS corrob
  FROM posts GROUP BY issue_key`);

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
  qInsert.run(issueKey, new Date().toISOString(), kind, text || null, status || null, photo || null);
  return thread(issueKey);
}

function countsAll() {
  const m = {};
  for (const r of qCounts.all()) m[r.issue_key] = r.corrob;
  return m;
}

module.exports = { addPost, thread, countsAll };
