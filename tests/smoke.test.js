const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const project = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unignorable-test-'));
const sourceData = process.env.DATA_DIR || path.join(project, 'data');
for (const name of fs.readdirSync(sourceData)) {
  if (name.endsWith('.json') || name === 'ugc.db') {
    fs.copyFileSync(path.join(sourceData, name), path.join(dataDir, name));
  }
}
fs.copyFileSync(
  path.join(project, 'tests', 'fixtures', 'campaign_evidence.json'),
  path.join(dataDir, 'campaign_evidence.json')
);
fs.copyFileSync(
  path.join(project, 'tests', 'fixtures', 'map-layers.json'),
  path.join(dataDir, 'map-layers.json')
);
const proximity = JSON.parse(fs.readFileSync(path.join(project, 'tests', 'fixtures', 'campaign-issue-proximity.json')));
const fixtureIssuesPath = path.join(dataDir, 'issues.json');
const fixtureIssues = JSON.parse(fs.readFileSync(fixtureIssuesPath));
const canary = fixtureIssues.find(item => item.type === proximity.type && item.id === proximity.id);
if (!canary) throw new Error('Campaign 001 fixture issue is missing');
canary.sensitive_sites = proximity.sensitive_sites;
canary.sensitive_site_summary = proximity.sensitive_site_summary;
fs.writeFileSync(fixtureIssuesPath, JSON.stringify(fixtureIssues));

const port = 18080 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
const reviewKey = 'test-only-review-key';
const child = spawn(process.execPath, ['server.js'], {
  cwd: project,
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, PUBLIC_ORIGIN: origin, REVIEW_KEY: reviewKey,
    TRUST_PROXY_HEADERS: '1', ROUTE_PAYWALL_BYPASS: '1', UPSTREAM_FIXTURES: path.join(project, 'tests', 'fixtures', 'upstreams.json') },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForOrigin(targetOrigin) {
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(`${targetOrigin}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('test server did not start');
}

const waitForServer = () => waitForOrigin(origin);

test.before(waitForServer);
test.after(() => {
  child.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('health and public assets are available with security headers', async () => {
  const health = await fetch(`${origin}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');

  const root = await fetch(origin, { redirect: 'manual' });
  assert.equal(root.status, 200);
  const rootHtml = await root.text();
  assert.match(rootHtml, /id="forecast-card"/);
  assert.match(rootHtml, /Current condition estimate/);
  assert.match(rootHtml, /Historical reports most often arrived/);
  assert.match(rootHtml, /uncalibrated model score/);
  assert.doesNotMatch(rootHtml, /% estimated presence/);
  assert.match(rootHtml, /Plan a route around it/);
  assert.match(rootHtml, /Homeless \/ encampment reports/);
  assert.match(rootHtml, /Drug activity/);
  assert.match(rootHtml, /Download exact route \(GPX\)/);
  assert.match(rootHtml, /aria-autocomplete="list"/);
  assert.match(rootHtml, /routes are \$1\/day or \$25\/year/);
  assert.match(rootHtml, /id="report-link" type="button">Action record<\/button>/);
  assert.match(rootHtml, /id="forecast-share"/);
  assert.match(rootHtml, /id="forecast-share-x"/);
  assert.match(rootHtml, /One condition · one loop/);
  assert.match(rootHtml, /Detected[\s\S]*Checked[\s\S]*Action[\s\S]*Outcome/);
  assert.match(rootHtml, /fetch\(`\/api\/condition-loop\?feature_id=/);
  assert.match(rootHtml, /params\.get\('forecast'\)/);
  assert.doesNotMatch(rootHtml, /id="report-panel"/);
  assert.doesNotMatch(rootHtml, /report-mode/);
  assert.match(rootHtml, /Public record \+ field updates/);
  assert.match(rootHtml, /fetch\('\/api\/report-issues'\)/);
  assert.match(rootHtml, /data-report-confirm/);
  assert.match(rootHtml, /map\.on\('contextmenu'/);
  assert.match(rootHtml, /--paper:#080b11/);
  assert.match(rootHtml, /radius:cluster\?3:2\.5/);
  assert.match(rootHtml, /FULL_DETAIL_ZOOM=14/);
  assert.match(rootHtml, /Evidence outline legend/);
  assert.match(rootHtml, /Choose each address from the list/);
  assert.doesNotMatch(rootHtml, /Build avoidance route/);
  assert.match(rootHtml, /OpenStreetMap Nominatim/);
  assert.match(rootHtml, /public Valhalla/);
  assert.match(rootHtml, /regular-route settings are saved only in this browser/);
  assert.match(rootHtml, /id="filter-card"/);
  assert.match(rootHtml, /id="layers-toggle"/);
  assert.match(rootHtml, /Selected layers show on the map and shape routes/);
  assert.match(rootHtml, /map\.on\('zoomend',\(\)=>\{syncLayers\(\);drawReportIssues\(\);renderForecast\(\);\}\)/);
  assert.doesNotMatch(rootHtml, /else loadReportIssues\(\)/);
  assert.match(rootHtml, /fetch\('\/api\/condition-observations'/);
  assert.match(rootHtml, /data-condition-state="present"/);
  assert.match(rootHtml, /data-results-back/);
  assert.match(rootHtml, /\.legend\{display:none\}/);
  assert.match(rootHtml, /id="swap-route"/);
  assert.match(rootHtml, /id="discover-toggle"/);
  assert.match(rootHtml, /Live Citi Bike/);
  assert.match(rootHtml, /api\/discover\/citibike/);
  assert.match(rootHtml, /L\.circleMarker\(\[state\.endpoints\.origin/);
  assert.match(rootHtml, /Turn-by-turn · \$\{steps\.length\} steps/);
  assert.match(rootHtml, /Finding your \$\{state\.profile\} route/);
  assert.match(rootHtml, /tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(rootHtml, /leaflet-tile-pane\{filter:invert\(1\) hue-rotate\(180deg\)/);
  assert.doesNotMatch(rootHtml, /basemaps\.cartocdn\.com/);
  assert.doesNotMatch(rootHtml, /pulse\.polyfeeds/);

  const forecastShare = await fetch(`${origin}/f?id=311-encampment-1`);
  assert.equal(forecastShare.status, 200);
  const forecastShareHtml = await forecastShare.text();
  assert.match(forecastShareHtml, /property="og:title"/);
  assert.match(forecastShareHtml, /summary_large_image/);
  assert.match(forecastShareHtml, /\/assets\/share-card\.png/);
  assert.match(forecastShareHtml, /a public forecast/);
  assert.match(forecastShareHtml, /Check this place/);
  assert.match(forecastShareHtml, /Make the city answer/);
  assert.match(forecastShareHtml, /city closures/);
  assert.match(forecastShareHtml, /Approximate public-data estimate/);
  assert.doesNotMatch(forecastShareHtml, /undefined|null/);
  const shareCard = await fetch(`${origin}/assets/share-card.png`);
  assert.equal(shareCard.status, 200);
  assert.equal(shareCard.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await shareCard.arrayBuffer()).subarray(1, 4).toString(), 'PNG');

  const atlanta = await fetch(`${origin}/api/jurisdiction?city=atlanta`);
  assert.equal(atlanta.status, 200);
  const atlantaData = await atlanta.json();
  assert.equal(atlantaData.jurisdiction.id, 'atlanta');
  assert.equal(atlantaData.jurisdiction.legal_context.statute, 'O.C.G.A. § 36-60-34');
  assert.equal(atlantaData.jurisdiction.legal_context.effective_date, '2026-07-01');
  assert.equal(atlantaData.jurisdiction.legal_context.remedy_adapter.reporter_reward, false);
  assert.equal(atlantaData.checklist_schema.example.attorney_review_ready, false);

  const conditionLoop = await fetch(`${origin}/api/condition-loop?feature_id=311-encampment-1`);
  assert.equal(conditionLoop.status, 200);
  const conditionLoopData = (await conditionLoop.json()).loop;
  assert.deepEqual(conditionLoopData.stages.map(item => item.id), ['detected', 'checked', 'action', 'outcome']);
  assert.equal(conditionLoopData.record.id, '40.746,-73.987');
  assert.equal(conditionLoopData.record.city_closures, 1587);
  assert.equal(conditionLoopData.checks.forecast_unchanged, true);

  const access = await fetch(`${origin}/api/access`);
  assert.equal(access.status, 200);
  assert.equal((await access.json()).active, true);

  const map = await fetch(`${origin}/map`);
  assert.equal(map.status, 200);
  const html = await map.text();
  assert.match(html, /\/vendor\/leaflet\.js/);
  assert.doesNotMatch(html, /name="robots" content="noindex"/);

  const reportRedirect = await fetch(`${origin}/report?lat=40.736&lng=-73.983`, { redirect: 'manual' });
  assert.equal(reportRedirect.status, 302);
  assert.match(reportRedirect.headers.get('location'), /^\/?\?(?=.*mode=report)(?=.*lat=40\.736)(?=.*lng=-73\.983)/);

  const report = await fetch(`${origin}/issues`);
  assert.equal(report.status, 200);
  const reportHtml = await report.text();
  assert.match(reportHtml, /Report an NYC issue/);
  assert.match(reportHtml, /href="\/map">Routes<\/a>/);
  assert.match(reportHtml, /Find your block/);
  assert.match(reportHtml, /I see this often/);
  assert.match(reportHtml, /fetch\('\/api\/post'/);
  assert.match(reportHtml, /URLSearchParams\(location\.search\).*app-shell/);
  assert.match(reportHtml, /radius:cluster\?3:2\.5/);
  assert.match(reportHtml, /tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(reportHtml, /leaflet-tile-pane\{filter:invert\(1\) hue-rotate\(180deg\)/);
  assert.doesNotMatch(reportHtml, /function radius\(/);

  const vendor = await fetch(`${origin}/vendor/leaflet.js`);
  assert.equal(vendor.status, 200);
  assert.match(vendor.headers.get('cache-control'), /immutable/);
});

test('missing runtime map data fails closed instead of serving fixtures', async () => {
  const missingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unignorable-no-map-'));
  for (const name of ['issues.json', 'trends.json', 'disparity.json']) {
    fs.copyFileSync(path.join(dataDir, name), path.join(missingDir, name));
  }
  const missingPort = port + 2000;
  const missingOrigin = `http://127.0.0.1:${missingPort}`;
  const missingChild = spawn(process.execPath, ['server.js'], {
    cwd: project,
    env: { ...process.env, PORT: String(missingPort), DATA_DIR: missingDir, PUBLIC_ORIGIN: missingOrigin, REVIEW_KEY: reviewKey,
      UPSTREAM_FIXTURES: path.join(project, 'tests', 'fixtures', 'upstreams.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForOrigin(missingOrigin);
    const layers = await fetch(`${missingOrigin}/api/map-layers`);
    assert.equal(layers.status, 503);
    assert.match((await layers.json()).error, /map data unavailable/i);
    const routes = await fetch(`${missingOrigin}/api/routes`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: { lat: 40.7506, lng: -73.9935 }, destination: { lat: 40.7189, lng: -73.9582 } }),
    });
    assert.equal(routes.status, 503);
  } finally {
    missingChild.kill('SIGTERM');
    fs.rmSync(missingDir, { recursive: true, force: true });
  }
});

test('free map layers and deterministic route comparison are available', async () => {
  const layerResponse = await fetch(`${origin}/api/map-layers`);
  assert.equal(layerResponse.status, 200);
  const layerData = await layerResponse.json();
  assert.equal(layerData.layers.alpr.length, 3);
  assert.equal(layerData.layers.homelessness.length, 1);
  assert.equal(layerData.layers.drugs.length, 1);
  assert.equal(layerData.layers.homelessness[0].responses.nypd_responded, 9);
  assert.equal(layerData.layers.drugs[0].responses.arrests, 1);
  assert.equal(layerData.layers.alpr.filter(item => item.manufacturer === 'Flock Safety').length, 1);
  assert.match(layerData.meta.caveats.join(' '), /not a complete or live inventory/i);

  const reportIssuesResponse = await fetch(`${origin}/api/report-issues`);
  assert.equal(reportIssuesResponse.status, 200);
  const reportIssues = await reportIssuesResponse.json();
  assert.ok(reportIssues.length > 0);
  assert.deepEqual(
    Object.keys(reportIssues[0]).sort(),
    ['addr','borough','closed_n','current_days','headline','id','last_seen','lat','lng','n','pattern','returned_n','score','seen','status','type'].sort()
  );
  assert.equal('episodes' in reportIssues[0], false);

  const geocode = await fetch(`${origin}/api/geocode?q=penn%20station`);
  assert.equal(geocode.status, 200);
  assert.equal((await geocode.json())[0].name, 'Penn Station, Manhattan, NY');

  const routes = await fetch(`${origin}/api/routes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      origin: { lat: 40.7506, lng: -73.9935 }, destination: { lat: 40.7189, lng: -73.9582 },
      via: { name: 'Citi Bike stop', lat: 40.735, lng: -73.98 },
      filters: ['alpr', 'street', 'homelessness'],
    }),
  });
  assert.equal(routes.status, 200);
  const payload = await routes.json();
  assert.equal(payload.fixture, true);
  assert.equal(payload.profile, 'driving');
  assert.match(payload.recommendation_policy, /hard-exclusion batch/i);
  assert.deepEqual(payload.selected, ['alpr', 'street', 'homelessness']);
  assert.equal(payload.via.name, 'Citi Bike stop');
  assert.ok(payload.avoidance.excluded_areas > 0);
  assert.ok(payload.avoidance.passes > 0);
  assert.equal(payload.routes.length, 3);
  assert.equal(payload.routes.filter(route => route.recommended).length, 1);
  assert.equal(payload.avoidance.improved, true);
  assert.equal(payload.routing_method, 'valhalla-bounded-avoidance-v4');
  assert.deepEqual(payload.strategy_portfolio, ['fastest']);
  assert.ok(payload.routes.some(route => route.avoidance_generated));
  assert.ok(payload.routes.every(route => Number.isFinite(route.metrics.alpr)));
  assert.ok(payload.routes.every(route => Array.isArray(route.steps) && route.steps.length > 0));
  assert.equal(typeof payload.routes[0].steps[0].instruction, 'string');
  assert.match(payload.caveat, /do not show whether a camera captured you/i);
  assert.equal(payload.radii_meters.alpr, 45);
  assert.equal(payload.radii_meters.street, 110);
  assert.match(payload.routes[0].export.google, /^https:\/\/www\.google\.com\/maps\/dir\//);
  assert.match(payload.routes[0].export.apple, /^https:\/\/maps\.apple\.com\//);
  assert.ok(payload.routes[0].export.shapingWaypoints > 0);
  assert.equal(payload.routes[0].export.includesVia, true);
  assert.match(new URL(payload.routes[0].export.google).searchParams.get('waypoints'), /^40\.735000,-73\.980000/);

  const walkingResponse = await fetch(`${origin}/api/routes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      origin: { lat: 40.7506, lng: -73.9935 }, destination: { lat: 40.7189, lng: -73.9582 },
      profile: 'walking', filters: ['drugs'],
    }),
  });
  assert.equal(walkingResponse.status, 200);
  const walking = await walkingResponse.json();
  assert.equal(walking.profile, 'walking');
  assert.equal(walking.directions_method, 'human-decision-summary-v1');
  assert.ok(walking.routes.every(route => route.steps.length > 0));
  assert.equal(new URL(walking.routes[0].export.google).searchParams.get('travelmode'), 'walking');
  assert.equal(new URL(walking.routes[0].export.apple).searchParams.get('mode'), 'walking');
  assert.ok(new URL(walking.routes[0].export.apple).searchParams.getAll('waypoint').length > 0);

  const fastestOnly = await fetch(`${origin}/api/routes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ origin: { lat: 40.7506, lng: -73.9935 }, destination: { lat: 40.7189, lng: -73.9582 }, filters: [] }),
  });
  const fastestPayload = await fastestOnly.json();
  assert.deepEqual(fastestPayload.selected, []);
  assert.equal(fastestPayload.recommendation_policy, 'fastest route');
  assert.equal(fastestPayload.routes.find(route => route.recommended).duration, 1320);

  const outOfBounds = await fetch(`${origin}/api/routes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ origin: { lat: 34, lng: -118 }, destination: { lat: 40.7189, lng: -73.9582 } }),
  });
  assert.equal(outOfBounds.status, 400);

  const jerseyCity = await fetch(`${origin}/api/routes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ origin: { lat: 40.7178, lng: -74.0431 }, destination: { lat: 40.7189, lng: -73.9582 } }),
  });
  assert.equal(jerseyCity.status, 400);

  const limitedHeaders = { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.77' };
  const limitedBody = JSON.stringify({ origin: { lat: 40.7506, lng: -73.9935 }, destination: { lat: 40.7189, lng: -73.9582 }, filters: [] });
  for (let index = 0; index < 60; index++) {
    assert.equal((await fetch(`${origin}/api/routes`, { method: 'POST', headers: limitedHeaders, body: limitedBody })).status, 200);
  }
  assert.equal((await fetch(`${origin}/api/routes`, { method: 'POST', headers: limitedHeaders, body: limitedBody })).status, 429);
});

test('residents can start or join a city-backed campaign', async () => {
  const issues = await (await fetch(`${origin}/api/issues`)).json();
  const issue = issues.find(item => item.status === 'active');
  assert.ok(issue);

  const startPage = await fetch(`${origin}/start?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`);
  assert.equal(startPage.status, 200);
  const startHtml = await startPage.text();
  assert.match(startHtml, /Start the campaign/);
  assert.match(startHtml, /pulse\.polyfeeds\.dev\/api\/ingest/);

  const nearby = await fetch(`${origin}/api/campaign/nearby?lat=${issue.lat}&lng=${issue.lng}`);
  assert.equal(nearby.status, 200);
  const nearbyJson = await nearby.json();
  assert.ok(nearbyJson.items.some(item => item.type === issue.type && item.id === issue.id));

  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.44' };
  const invalid = await fetch(`${origin}/api/campaign/start`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: issue.type, id: issue.id, email: 'not-an-email', confirmed: true }),
  });
  assert.equal(invalid.status, 400);

  const body = JSON.stringify({ type: issue.type, id: issue.id, email: 'organizer@example.com', confirmed: true });
  const first = await fetch(`${origin}/api/campaign/start`, { method: 'POST', headers, body });
  assert.equal(first.status, 200);
  const firstJson = await first.json();
  assert.match(firstJson.url, /\/c\?t=/);

  const second = await fetch(`${origin}/api/campaign/start`, { method: 'POST', headers, body });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).existed, true);

  const campaign = await fetch(firstJson.url);
  const campaignHtml = await campaign.text();
  assert.match(campaignHtml, /Your block can be next/);
  assert.match(campaignHtml, /pulse\.polyfeeds\.dev\/api\/ingest/);
  assert.doesNotMatch(campaignHtml, /organizer@example\.com/);
});

test('nearby community submissions are saved unreviewed, deduplicated, and distance checked', async () => {
  const body = { feature_id: '311-encampment-1', state: 'present', lat: 40.746, lng: -73.987 };
  const first = await fetch(`${origin}/api/condition-observations`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.44' }, body: JSON.stringify(body),
  });
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.equal(firstPayload.accepted, true);
  assert.equal(firstPayload.provenance, 'community_unreviewed');
  assert.equal(firstPayload.review_status, 'unreviewed');
  assert.equal(firstPayload.forecast_unchanged, true);
  assert.match(firstPayload.message, /saved for review/i);
  assert.match(firstPayload.message, /do not change the forecast/i);
  const observationDb = new DatabaseSync(path.join(dataDir, 'ugc.db'), { readOnly: true });
  const stored = observationDb.prepare(`SELECT id,provenance,review_status,model_score,model_version,model_contract_version,model_probability
    FROM condition_observations WHERE feature_id=? ORDER BY id DESC LIMIT 1`).get(body.feature_id);
  observationDb.close();
  const { id: observationId, ...storedFields } = stored;
  assert.deepEqual({ ...storedFields }, {
    provenance: 'community_unreviewed', review_status: 'unreviewed', model_score: 0.79,
    model_version: 'walk-nowcast-v3-shadow', model_contract_version: 'condition-forecast-v1', model_probability: null,
  });
  const duplicate = await fetch(`${origin}/api/condition-observations`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.44' }, body: JSON.stringify(body),
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  const far = await fetch(`${origin}/api/condition-observations`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.45' },
    body: JSON.stringify({ ...body, lat: 40.72, lng: -74.01 }),
  });
  assert.equal(far.status, 400);

  const review = await fetch(`${origin}/api/review`, { headers: { cookie: `unig_review=${reviewKey}` } });
  assert.equal(review.status, 200);
  const reviewPayload = await review.json();
  assert.ok(reviewPayload.condition_items.some(item => item.id === observationId));
  const decision = await fetch(`${origin}/api/review/condition/decide`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: `unig_review=${reviewKey}` },
    body: JSON.stringify({ id: observationId, action: 'approve' }),
  });
  assert.equal(decision.status, 200);
  const decisionPayload = await decision.json();
  assert.equal(decisionPayload.item.review_status, 'approved');
  assert.equal(decisionPayload.item.provenance, 'community_reviewed');
  const loop = (await (await fetch(`${origin}/api/condition-loop?feature_id=${body.feature_id}`)).json()).loop;
  assert.ok(loop.checks.reviewed >= 1);
  assert.ok(loop.stage_index >= 1);
});

test('Campaign 001 separates reporting evidence from observation and issues permanent action receipts', async () => {
  const type = 'Encampment', id = '40.736,-73.983';
  const campaign = await fetch(`${origin}/c?t=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
  assert.equal(campaign.status, 200);
  const html = await campaign.text();
  assert.match(html, /near 246 East 20th Street/i);
  assert.match(html, /supports[\s\S]*continuous occupation/i);
  assert.match(html, /continuity confidence/i);
  assert.match(html, /March 18, 2026/);
  assert.match(html, /Likely interruption; return supported/i);
  assert.match(html, /does not document a cleanup/i);
  assert.match(html, /evidence index, not a probability/i);
  assert.match(html, /Dated neighbor observation/);
  assert.match(html, /LearningSpring School/i);
  assert.match(html, /3 schools within 500 feet/i);
  assert.match(html, /It is unacceptable for the city/i);
  assert.match(html, /\$831-\$3\.3k/);
  assert.match(html, /59 deduplicated response-days/i);
  assert.match(html, /Not an audited bill/i);
  assert.doesNotMatch(html, /Sheepshead Bay/i);
  assert.doesNotMatch(html, /A tent has been here/);

  const prepared = await fetch(`${origin}/api/action/prepare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.71' },
    body: JSON.stringify({ action_type: 'email_official', type, id }),
  });
  assert.equal(prepared.status, 200);
  const action = await prepared.json();
  assert.match(action.href, /^mailto:District2@council\.nyc\.gov/i);
  assert.match(decodeURIComponent(action.href), new RegExp(`/r/${action.receipt}`));

  const before = await fetch(action.receiptUrl);
  assert.equal(before.status, 200);
  const beforeHtml = await before.text();
  assert.match(beforeHtml, /Tracked-link requests[\s\S]*?0/);
  assert.match(beforeHtml, /Sender confirmation[\s\S]*?Not confirmed/);

  const tracked = await fetch(`${origin}/r/${action.receipt}`, { redirect: 'manual' });
  assert.equal(tracked.status, 302);
  assert.match(tracked.headers.get('location'), /^\/c\?t=Encampment/);

  const after = await fetch(action.receiptUrl);
  const receiptHtml = await after.text();
  assert.match(receiptHtml, /Tracked-link requests[\s\S]*?1/);
  assert.match(receiptHtml, /does not prove[\s\S]*personally read it/i);

  const confirmed = await fetch(`${origin}/api/action/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.72' },
    body: JSON.stringify({ token: action.receipt }),
  });
  assert.equal(confirmed.status, 200);
  assert.ok((await confirmed.json()).receipt.sender_confirmed_at);
  const confirmedHtml = await (await fetch(action.receiptUrl)).text();
  assert.doesNotMatch(confirmedHtml, />I sent this</);
  assert.match(confirmedHtml, /Sender confirmation[\s\S]*?ET/);
});

test('issues include production card fields', async () => {
  const response = await fetch(`${origin}/api/issues`);
  assert.equal(response.status, 200);
  const issues = await response.json();
  assert.ok(issues.length > 100);
  assert.equal(typeof issues[0].seen, 'number');
  assert.ok('nothing_found' in issues[0]);
});

test('confirmation validates issue and deduplicates by source', async () => {
  const issues = await (await fetch(`${origin}/api/issues`)).json();
  const issue = issues[0];
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' };
  const body = JSON.stringify({ type: issue.type, id: issue.id });

  const first = await fetch(`${origin}/api/seen`, { method: 'POST', headers, body });
  assert.equal(first.status, 200);
  const firstJson = await first.json();

  const second = await fetch(`${origin}/api/seen`, { method: 'POST', headers, body });
  assert.equal(second.status, 200);
  const secondJson = await second.json();
  assert.equal(secondJson.corrob, firstJson.corrob);
  assert.equal(secondJson.duplicate, true);

  const unknown = await fetch(`${origin}/api/seen`, {
    method: 'POST', headers, body: JSON.stringify({ type: 'Unknown', id: 'missing' }),
  });
  assert.equal(unknown.status, 400);
});

test('malformed JSON is rejected and deep links resolve', async () => {
  const bad = await fetch(`${origin}/api/seen`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.88' }, body: '{',
  });
  assert.equal(bad.status, 400);

  const issues = await (await fetch(`${origin}/api/issues`)).json();
  const issue = issues[0];
  const campaign = await fetch(`${origin}/c?t=${encodeURIComponent(issue.type)}&id=${encodeURIComponent(issue.id)}`);
  assert.equal(campaign.status, 200);
  const campaignHtml = await campaign.text();
  assert.match(campaignHtml, /reporting episode/i);
  assert.match(campaignHtml, /onclick="confirmIssue\(this\)"/);
  assert.match(campaignHtml, /data-url="https?:\/\/[^"<>]+" onclick="logAct\('share_card'\);copyLink\(this\.dataset\.url\)"/);
  assert.doesNotMatch(campaignHtml, /this\.textContent='Confirmed'/);
});

test('review key bootstraps an HTTP-only cookie and leaves the URL', async () => {
  const bootstrap = await fetch(`${origin}/review?k=${encodeURIComponent(reviewKey)}`, { redirect: 'manual' });
  assert.equal(bootstrap.status, 303);
  assert.equal(bootstrap.headers.get('location'), '/review');
  const setCookie = bootstrap.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);

  const denied = await fetch(`${origin}/api/review`);
  assert.equal(denied.status, 401);
  const cookie = setCookie.split(';')[0];
  const allowed = await fetch(`${origin}/api/review`, { headers: { cookie } });
  assert.equal(allowed.status, 200);
});
