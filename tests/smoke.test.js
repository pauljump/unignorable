const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

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

const port = 18080 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
const reviewKey = 'test-only-review-key';
const child = spawn(process.execPath, ['server.js'], {
  cwd: project,
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, PUBLIC_ORIGIN: origin, REVIEW_KEY: reviewKey },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('test server did not start');
}

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
  assert.equal(root.status, 302);
  assert.match(root.headers.get('location'), /^\/c\?t=Encampment/);

  const map = await fetch(`${origin}/map`);
  assert.equal(map.status, 200);
  const html = await map.text();
  assert.match(html, /\/vendor\/leaflet\.js/);
  assert.doesNotMatch(html, /name="robots" content="noindex"/);

  const vendor = await fetch(`${origin}/vendor/leaflet.js`);
  assert.equal(vendor.status, 200);
  assert.match(vendor.headers.get('cache-control'), /immutable/);
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
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' };
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
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
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
