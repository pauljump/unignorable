const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const project = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unignorable-test-'));
const sourceData = path.join(project, 'data');
for (const name of fs.readdirSync(sourceData)) {
  if (name.endsWith('.json') || name === 'ugc.db' || name === 'admin-key') {
    fs.copyFileSync(path.join(sourceData, name), path.join(dataDir, name));
  }
}

const port = 18080 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: project,
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, PUBLIC_ORIGIN: origin },
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
  assert.match(campaignHtml, /estimated city response cost/i);
  assert.match(campaignHtml, /onclick="confirmIssue\(this\)"/);
  assert.match(campaignHtml, /data-url="https?:\/\/[^"<>]+" onclick="logAct\('share_card'\);copyLink\(this\.dataset\.url\)"/);
  assert.doesNotMatch(campaignHtml, /this\.textContent='Confirmed'/);
});

test('review key bootstraps an HTTP-only cookie and leaves the URL', async () => {
  const key = fs.readFileSync(path.join(dataDir, 'admin-key'), 'utf8').trim();
  const bootstrap = await fetch(`${origin}/review?k=${encodeURIComponent(key)}`, { redirect: 'manual' });
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
