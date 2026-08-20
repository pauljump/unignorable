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

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const db = new DatabaseSync(path.join(dataDir, 'ugc.db'));
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
if (!cols.includes('ip_hash')) db.exec(`ALTER TABLE posts ADD COLUMN ip_hash TEXT`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_mod ON posts(mod)`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_seen_ip ON posts(issue_key,ip_hash) WHERE kind='seen' AND ip_hash IS NOT NULL`);

// Proximity-verified field observations calibrate the latent encampment model. No name, raw IP,
// trip, or free text is stored. One observer can contribute one state per site per UTC day.
db.exec(`
  CREATE TABLE IF NOT EXISTS condition_observations(
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id        TEXT NOT NULL,
    state             TEXT NOT NULL,
    observed_at       TEXT NOT NULL,
    observation_day   TEXT NOT NULL,
    submitted_at      TEXT NOT NULL,
    observer_hash     TEXT NOT NULL,
    distance_m        REAL NOT NULL,
    model_probability REAL,
    model_version     TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_condition_observer_day
    ON condition_observations(feature_id,observer_hash,observation_day);
  CREATE INDEX IF NOT EXISTS idx_condition_feature_time
    ON condition_observations(feature_id,observed_at);
`);
const qConditionInsert = db.prepare(`INSERT OR IGNORE INTO condition_observations(
  feature_id,state,observed_at,observation_day,submitted_at,observer_hash,distance_m,model_probability,model_version
) VALUES(?,?,?,?,?,?,?,?,?)`);
const qConditionSummary = db.prepare(`SELECT state,count(*) observations,count(distinct observer_hash) observers,
  max(observed_at) last_observed_at FROM condition_observations
  WHERE feature_id=? AND observed_at>=? GROUP BY state`);

// A walk opportunity is deliberately not an observation. It records only that an opted-in
// navigator passed a mapped site closely enough to have had an opportunity to see it. The raw
// coordinate is checked by the server and discarded; these rows are for sampling and calibration
// coverage, never a positive or negative input to the presence model.
db.exec(`
  CREATE TABLE IF NOT EXISTS walk_opportunities(
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id        TEXT NOT NULL,
    observed_at       TEXT NOT NULL,
    observation_day   TEXT NOT NULL,
    submitted_at      TEXT NOT NULL,
    observer_hash     TEXT NOT NULL,
    distance_bucket   TEXT NOT NULL,
    model_probability REAL,
    model_version     TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_walk_opportunity_observer_day
    ON walk_opportunities(feature_id,observer_hash,observation_day);
  CREATE INDEX IF NOT EXISTS idx_walk_opportunity_feature_time
    ON walk_opportunities(feature_id,observed_at);
`);
const qOpportunityInsert = db.prepare(`INSERT OR IGNORE INTO walk_opportunities(
  feature_id,observed_at,observation_day,submitted_at,observer_hash,distance_bucket,model_probability,model_version
) VALUES(?,?,?,?,?,?,?,?)`);
const qOpportunitySummary = db.prepare(`SELECT count(*) opportunities,count(distinct observer_hash) observers,
  max(observed_at) last_observed_at FROM walk_opportunities WHERE feature_id=? AND observed_at>=?`);

// Coarse, opt-in walking-friction aggregates. These are behavioral signals, not observations of
// a civic condition. There is no stored route, coordinate, heading, or per-sample timestamp.
db.exec(`
  CREATE TABLE IF NOT EXISTS walk_friction_events(
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id             TEXT NOT NULL,
    observation_day        TEXT NOT NULL,
    hour_bucket            INTEGER NOT NULL,
    observer_hash          TEXT NOT NULL,
    proximity_bucket       TEXT NOT NULL,
    speed_change_bucket    TEXT NOT NULL,
    clearance_delta_bucket TEXT NOT NULL,
    dwell_bucket           TEXT NOT NULL,
    sample_count           INTEGER NOT NULL,
    model_probability      REAL,
    model_version          TEXT,
    submitted_at           TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_walk_friction_observer_day
    ON walk_friction_events(feature_id,observer_hash,observation_day);
  CREATE INDEX IF NOT EXISTS idx_walk_friction_feature_day
    ON walk_friction_events(feature_id,observation_day);
`);
const qFrictionInsert = db.prepare(`INSERT OR IGNORE INTO walk_friction_events(
  feature_id,observation_day,hour_bucket,observer_hash,proximity_bucket,speed_change_bucket,
  clearance_delta_bucket,dwell_bucket,sample_count,model_probability,model_version,submitted_at
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
const qFrictionSummary = db.prepare(`SELECT count(*) events,count(distinct observer_hash) observers
  FROM walk_friction_events WHERE feature_id=? AND observation_day>=?`);

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

  CREATE TABLE IF NOT EXISTS campaign_organizers(
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_key  TEXT NOT NULL,
    email      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ip_hash    TEXT,
    UNIQUE(issue_key, email)
  );
  CREATE INDEX IF NOT EXISTS idx_campaign_organizers_issue ON campaign_organizers(issue_key);
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

  CREATE TABLE IF NOT EXISTS action_receipts(
    token       TEXT PRIMARY KEY,
    issue_key   TEXT NOT NULL,
    action_type TEXT NOT NULL,
    target      TEXT,
    created_at  TEXT NOT NULL,
    ip_hash     TEXT,
    link_requests INTEGER NOT NULL DEFAULT 0,
    first_link_request_at TEXT,
    last_link_request_at TEXT,
    sender_confirmed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_action_receipts_issue ON action_receipts(issue_key);
`);
// Forward migration: add ip_hash if missing on older DBs.
{
  const actCols = db.prepare(`PRAGMA table_info(actions)`).all().map(c => c.name);
  if (!actCols.includes('ip_hash')) db.exec(`ALTER TABLE actions ADD COLUMN ip_hash TEXT`);
  const receiptCols = db.prepare(`PRAGMA table_info(action_receipts)`).all().map(c => c.name);
  if (!receiptCols.includes('sender_confirmed_at')) db.exec(`ALTER TABLE action_receipts ADD COLUMN sender_confirmed_at TEXT`);
}

// ---- Areas table (shareable ZONE bundles — many issue-cells under one permalink) ----
// A citizen frames a cluster on the map and shares it as ONE URL (/a/<id>). The member set is
// FROZEN at mint (the "these instances" definition); the page recomputes their stats live at render.
// fingerprint = stable hash of the rounded bbox + sorted types, so re-sharing the same zone reuses
// the same row (share_count stays meaningful per-zone instead of minting duplicates).
db.exec(`
  CREATE TABLE IF NOT EXISTS areas(
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL DEFAULT 'user',  -- 'user' (frozen mint) | 'hotspot' (auto, live membership)
    fingerprint TEXT,
    created_at  TEXT NOT NULL,
    bbox        TEXT NOT NULL,   -- JSON {s,w,n,e}
    types       TEXT NOT NULL,   -- JSON array of complaint-type names
    member_keys TEXT NOT NULL,   -- JSON array of "type|id" (frozen zone membership; '[]' for hotspots)
    snapshot    TEXT,            -- JSON aggregate stats at mint (OG fallback / dedupe display)
    title       TEXT,
    share_count INTEGER NOT NULL DEFAULT 0,
    view_count  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_areas_fp ON areas(fingerprint);
`);
// Forward migration: add `kind` to older `areas` tables (Phase 1 shipped without it).
{
  const areaCols = db.prepare(`PRAGMA table_info(areas)`).all().map(c => c.name);
  if (!areaCols.includes('kind')) db.exec(`ALTER TABLE areas ADD COLUMN kind TEXT NOT NULL DEFAULT 'user'`);
}
const qAreaInsert = db.prepare(`INSERT INTO areas(id,fingerprint,created_at,bbox,types,member_keys,snapshot,title) VALUES(?,?,?,?,?,?,?,?)`);
const qAreaGet    = db.prepare(`SELECT * FROM areas WHERE id=?`);
const qAreaByFp   = db.prepare(`SELECT * FROM areas WHERE fingerprint=? LIMIT 1`);
const qAreaShare  = db.prepare(`UPDATE areas SET share_count=share_count+1 WHERE id=?`);
const qAreaView   = db.prepare(`UPDATE areas SET view_count=view_count+1 WHERE id=?`);

// Create (or reuse, by fingerprint) a shareable area. Returns the row.
function createArea({ fingerprint, bbox, types, memberKeys, snapshot, title }) {
  if (fingerprint) {
    const existing = qAreaByFp.get(fingerprint);
    if (existing) return existing;
  }
  const id = crypto.randomBytes(5).toString('hex'); // 10-char short id
  qAreaInsert.run(
    id, fingerprint || null, new Date().toISOString(),
    JSON.stringify(bbox), JSON.stringify(types), JSON.stringify(memberKeys),
    snapshot ? JSON.stringify(snapshot) : null, title || null,
  );
  return qAreaGet.get(id);
}
function getArea(id)   { return qAreaGet.get(id) || null; }
function bumpAreaShare(id) { qAreaShare.run(id); }
function bumpAreaView(id)  { qAreaView.run(id); }

// Hotspots — auto-detected zones with STABLE slugs. Recomputed at boot; upsert preserves counters.
const qHotspotUpsert = db.prepare(`
  INSERT INTO areas(id,kind,created_at,bbox,types,member_keys,snapshot,title)
  VALUES(?, 'hotspot', ?, ?, ?, '[]', ?, ?)
  ON CONFLICT(id) DO UPDATE SET bbox=excluded.bbox, types=excluded.types, snapshot=excluded.snapshot, title=excluded.title`);
const qHotspotAll = db.prepare(`SELECT * FROM areas WHERE kind='hotspot'`);
function upsertHotspot({ slug, bbox, types, snapshot, title }) {
  qHotspotUpsert.run(slug, new Date().toISOString(), JSON.stringify(bbox), JSON.stringify(types),
    snapshot ? JSON.stringify(snapshot) : null, title || null);
}
function listHotspots() { return qHotspotAll.all(); }

// Campaign prepared statements.
const qCampInsert   = db.prepare(`INSERT OR IGNORE INTO campaigns(issue_key,started_at,status) VALUES(?,?,?)`);
const qCampGet      = db.prepare(`SELECT * FROM campaigns WHERE issue_key=?`);
const qCampSetStatus = db.prepare(`UPDATE campaigns SET status=?, won_at=? WHERE issue_key=?`);
const qCampAll      = db.prepare(`SELECT * FROM campaigns`);
const qOrganizerInsert = db.prepare(`INSERT OR IGNORE INTO campaign_organizers(issue_key,email,created_at,ip_hash) VALUES(?,?,?,?)`);

// Action prepared statements.
const qActInsert    = db.prepare(`INSERT INTO actions(issue_key,action_type,ts,ip_hash) VALUES(?,?,?,?)`);
const qActByIssue   = db.prepare(`SELECT action_type, ts FROM actions WHERE issue_key=? ORDER BY id ASC`);
const qActHas       = db.prepare(`SELECT 1 FROM actions WHERE issue_key=? AND action_type=? LIMIT 1`);
const qActFirst     = db.prepare(`SELECT ts FROM actions WHERE issue_key=? AND action_type=? ORDER BY id ASC LIMIT 1`);
const qReceiptInsert = db.prepare(`INSERT INTO action_receipts(token,issue_key,action_type,target,created_at,ip_hash) VALUES(?,?,?,?,?,?)`);
const qReceiptGet = db.prepare(`SELECT * FROM action_receipts WHERE token=?`);
const qReceiptClick = db.prepare(`UPDATE action_receipts SET link_requests=link_requests+1,
  first_link_request_at=COALESCE(first_link_request_at,?), last_link_request_at=? WHERE token=?`);
const qReceiptConfirm = db.prepare(`UPDATE action_receipts SET sender_confirmed_at=? WHERE token=? AND sender_confirmed_at IS NULL`);

const qInsert  = db.prepare(`INSERT INTO posts(issue_key,ts,kind,text,status,photo,mod,ip_hash) VALUES(?,?,?,?,?,?,?,?)`);
const qSeenInsert = db.prepare(`INSERT OR IGNORE INTO posts(issue_key,ts,kind,text,status,photo,mod,ip_hash) VALUES(?,?,'seen',NULL,'still_here',NULL,'approved',?)`);
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

function addPost(issueKey, kind, text, status, photo, ipHash) {
  const mod = kind === 'seen' ? 'approved' : 'pending';    // taps live; reports wait for Paul
  qInsert.run(issueKey, new Date().toISOString(), kind, text || null, status || null, photo || null, mod, ipHash || null);
  return { ...thread(issueKey), pending: mod === 'pending' };
}

function addSeen(issueKey, ipHash) {
  const result = qSeenInsert.run(issueKey, new Date().toISOString(), ipHash || null);
  return { ...thread(issueKey), duplicate: Number(result.changes) === 0 };
}

function countsAll() {
  const m = {};
  for (const r of qCounts.all()) m[r.issue_key] = r.corrob;
  return m;
}

function addConditionObservation({ featureId, state, observedAt, observerHash, distance, modelProbability, modelVersion }) {
  const timestamp = new Date(observedAt).toISOString();
  const result = qConditionInsert.run(featureId, state, timestamp, timestamp.slice(0, 10), new Date().toISOString(),
    observerHash, Number(distance), Number.isFinite(modelProbability) ? modelProbability : null, modelVersion || null);
  return { accepted: Number(result.changes) === 1, duplicate: Number(result.changes) === 0 };
}

function conditionObservationSummary(featureId, days = 30) {
  const since = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString();
  return qConditionSummary.all(featureId, since);
}

function addWalkOpportunity({ featureId, observedAt, observerHash, distanceBucket, modelProbability, modelVersion }) {
  const timestamp = new Date(observedAt).toISOString();
  const result = qOpportunityInsert.run(featureId, timestamp, timestamp.slice(0, 10), new Date().toISOString(), observerHash, distanceBucket, Number.isFinite(modelProbability) ? modelProbability : null, modelVersion || null);
  return { accepted: Number(result.changes) === 1, duplicate: Number(result.changes) === 0 };
}

function walkOpportunitySummary(featureId, days = 30) {
  const since = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString();
  return qOpportunitySummary.get(featureId, since) || { opportunities: 0, observers: 0, last_observed_at: null };
}

function addWalkFrictionEvent({ featureId, observedAt, observerHash, proximityBucket, speedChangeBucket, clearanceDeltaBucket, dwellBucket, sampleCount, modelProbability, modelVersion }) {
  const timestamp = new Date(observedAt);
  const result = qFrictionInsert.run(featureId, timestamp.toISOString().slice(0, 10), timestamp.getUTCHours(), observerHash, proximityBucket, speedChangeBucket, clearanceDeltaBucket, dwellBucket, Math.max(1, Math.floor(Number(sampleCount) || 1)), Number.isFinite(modelProbability) ? modelProbability : null, modelVersion || null, new Date().toISOString());
  return { accepted: Number(result.changes) === 1, duplicate: Number(result.changes) === 0 };
}

function walkFrictionSummary(featureId, days = 30) {
  const since = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString().slice(0, 10);
  return qFrictionSummary.get(featureId, since) || { events: 0, observers: 0 };
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

function addCampaignOrganizer(issueKey, email, ipHash) {
  qOrganizerInsert.run(issueKey, email.trim().toLowerCase(), new Date().toISOString(), ipHash || null);
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

function createActionReceipt(issueKey, actionType, target, ipHash) {
  const token = crypto.randomBytes(16).toString('hex');
  qReceiptInsert.run(token, issueKey, actionType, target || null, new Date().toISOString(), ipHash || null);
  return qReceiptGet.get(token);
}

function getActionReceipt(token) {
  return qReceiptGet.get(token) || null;
}

function recordReceiptLinkRequest(token) {
  const now = new Date().toISOString();
  qReceiptClick.run(now, now, token);
  return qReceiptGet.get(token) || null;
}

function confirmActionReceipt(token) {
  const result = qReceiptConfirm.run(new Date().toISOString(), token);
  return { receipt: qReceiptGet.get(token) || null, changed: Number(result.changes) === 1 };
}

module.exports = { addPost, addSeen, thread, countsAll, pending, pendingCount, decide,
  addConditionObservation, conditionObservationSummary, addWalkOpportunity, walkOpportunitySummary,
  addWalkFrictionEvent, walkFrictionSummary,
  startCampaign, getCampaign, setCampaignStatus, allCampaigns, addCampaignOrganizer,
  logAction, actionCounts, hasAction, firstActionTs,
  createActionReceipt, getActionReceipt, recordReceiptLinkRequest, confirmActionReceipt,
  createArea, getArea, bumpAreaShare, bumpAreaView,
  upsertHotspot, listHotspots };
