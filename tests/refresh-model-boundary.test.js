const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

test('seeded community submissions cannot change generated condition, nowcast, or routing fields', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'unignorable-model-boundary-'));
  const sidewalkPath = path.join(temp, 'sidewalk.db');
  const source = new DatabaseSync(sidewalkPath);
  source.exec(`CREATE TABLE sr311(
    unique_key TEXT, complaint_type TEXT, created_date TEXT, closed_date TEXT, agency TEXT, status TEXT,
    resolution_description TEXT, resolution_action_updated_date TEXT, incident_address TEXT, borough TEXT,
    latitude REAL, longitude REAL
  )`);
  const insert = source.prepare(`INSERT INTO sr311 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let day = 11; day <= 19; day += 1) {
    insert.run(String(day), 'Encampment', `2026-08-${day}T07:30:00.000`, null, 'NYPD', 'Closed',
      day === 19 ? 'The Police Department visited and observed an encampment.' : null,
      day === 19 ? '2026-08-19T09:00:00.000' : null, '100 WEST 23 STREET', 'MANHATTAN', 40.746, -73.987);
  }
  source.close();

  const previousDb = process.env.DB, previousData = process.env.DATA_DIR;
  process.env.DB = sidewalkPath; process.env.DATA_DIR = temp;
  const modulePath = require.resolve('../scripts/refresh-map-data');
  delete require.cache[modulePath];
  const { buildEncampmentSites } = require(modulePath);
  const { routingLevel } = require('../condition-model');
  const now = new Date('2026-08-20T16:00:00Z');
  const baseline = buildEncampmentSites(now)[0];

  const community = new DatabaseSync(path.join(temp, 'ugc.db'));
  community.exec(`CREATE TABLE condition_observations(
    feature_id TEXT,state TEXT,observed_at TEXT,observer_hash TEXT,review_status TEXT,provenance TEXT
  )`);
  const seed = community.prepare(`INSERT INTO condition_observations VALUES(?,?,?,?,?,?)`);
  for (let index = 0; index < 20; index += 1) {
    seed.run(baseline.id, index % 2 ? 'present' : 'absent', `2026-08-20T${String(index).padStart(2, '0')}:00:00Z`,
      `observer-${index}`, 'unreviewed', 'community_unreviewed');
  }
  community.close();
  const afterSeed = buildEncampmentSites(now)[0];

  const projection = feature => ({
    condition: feature.condition,
    nowcast: feature.nowcast,
    routing: routingLevel(feature),
  });
  assert.deepEqual(projection(afterSeed), projection(baseline));
  assert.equal('field_observation_count' in afterSeed, false);

  if (previousDb == null) delete process.env.DB; else process.env.DB = previousDb;
  if (previousData == null) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousData;
  fs.rmSync(temp, { recursive: true, force: true });
});
