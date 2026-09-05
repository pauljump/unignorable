const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { eligibleRecord, recordPath, renderRecord, renderDirectory, outcomeProof } = require('../condition-record');
const feature = { id: 'site & one', subject_type: 'encampment', address: '<Block & Avenue>', count: 582,
  distinct_report_days: 188, first_seen: '2021-05-01', last_seen: '2026-09-01',
  source_url: 'https://data.cityofnewyork.us/d/erm2-nwe9', location_uncertainty_m: 65 };
test('only substantive source records qualify for pilot indexing', () => {
  assert.equal(eligibleRecord(feature), true);
  for (const patch of [{ address: '' }, { distinct_report_days: 1 }, { first_seen: '2026-09-01' }, { source_url: 'https://other.test' }, { last_seen: null }, { subject_type: 'other' }]) {
    assert.equal(eligibleRecord({ ...feature, ...patch }), false);
  }
  assert.equal(recordPath(feature), '/f?id=site%20%26%20one');
});
test('record separates aggregations, escapes source text, and does not claim fresh or reviewed evidence', () => {
  const html = renderRecord({ feature, origin: 'https://example.test', indexable: false, meta: {}, loop: {
    checks: { reviewed: 0, pending: 1 }, durable_resolution: { required_quiet_days: 60 },
    record: { reports: 718, city_closures: 695, returns_after_closure: 306, distance_m: 42, href: '/c?t=Encampment&id=legacy' }
  } });
  assert.match(html, /&lt;Block &amp; Avenue&gt;/);
  assert.doesNotMatch(html, /<Block|undefined|null|summary_large_image|og:image/);
  assert.match(html, /582/); assert.match(html, /718 legacy reports/);
  assert.match(html, /must not be added/);
  assert.match(html, /Current status needs a fresh check/);
  assert.match(html, /awaiting review/);
  assert.match(html, /noindex,follow/);
  assert.match(html, /data-check-state="absent"/);
  assert.match(html, /data-check-state="uncertain"/);
  assert.doesNotMatch(html, /href="\/c[^>]+>Review history &amp; prepare/);
  assert.match(renderDirectory([], 'https://example.test'), /Missing data does not mean a condition is resolved/);
});
const row = (state, day) => ({ state, observed_at: `2026-${day}T12:00:00Z`, observation_day: `2026-${day}` });
const base = { claimAt: '2026-07-01T12:00:00Z', observations: [row('present', '06-30'), row('absent', '07-08'), row('absent', '08-31')], quietDays: 61, requiredDays: 60, contradicted: false };
test('Held requires reviewed prior presence, distinct absence days and an endpoint check', () => {
  assert.equal(outcomeProof(base).held, true);
  assert.equal(outcomeProof({ ...base, observations: base.observations.slice(1) }).held, false);
  assert.equal(outcomeProof({ ...base, observations: [row('present', '06-30'), row('absent', '07-08'), row('absent', '07-09')] }).held, false);
  assert.equal(outcomeProof({ ...base, observations: [row('present', '06-30'), row('absent', '08-31'), row('absent', '08-31')] }).held, false);
  assert.equal(outcomeProof({ ...base, quietDays: 20 }).held, false);
  assert.equal(outcomeProof({ ...base, claimAt: null }).held, false);
  assert.equal(outcomeProof({ ...base, contradicted: true }).held, false);
  assert.equal(outcomeProof({ ...base, observations: [...base.observations, row('present', '09-01')] }).held, false);
  assert.equal(outcomeProof({ ...base, observations: [row('present', '07-01'), ...base.observations.slice(1)] }).held, false);
});

test('inline check requests location only on intent, recovers from denial, and keeps coordinates out of metrics', async () => {
  const element = dataset => ({ dataset, disabled: false, textContent: '', listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } });
  const buttons = ['present', 'absent', 'uncertain'].map(state => element({ checkState: state }));
  const status = element(), copyStatus = element(), copy = element();
  const requests = [], locationCalls = [];
  const storage = () => { const data = new Map(); return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) }; };
  const document = {
    hidden: false, addEventListener() {},
    querySelector: selector => selector === '[data-record-id]' ? { dataset: { recordId: 'test-site' } } : { href: 'https://local.test/f?id=test-site' },
    querySelectorAll: () => buttons,
    getElementById: id => ({ 'check-status': status, 'copy-status': copyStatus, 'copy-record': copy }[id])
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'record-client.js'), 'utf8'), {
    document, sessionStorage: storage(), localStorage: storage(), performance: { now: () => 0 }, setInterval() {}, clearInterval() {},
    navigator: { geolocation: { getCurrentPosition: (success, failure) => locationCalls.push({ success, failure }) }, clipboard: { writeText: async () => {} } },
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ accepted: true }) }; }
  });
  assert.equal(locationCalls.length, 0);
  buttons[0].listeners.click();
  assert.equal(locationCalls.length, 1);
  assert.ok(buttons.every(button => button.disabled));
  locationCalls[0].failure();
  assert.match(status.textContent, /Nothing was submitted/);
  assert.ok(buttons.every(button => !button.disabled));
  assert.equal(requests.filter(request => request.url.includes('observations')).length, 0);
  buttons[2].listeners.click();
  await locationCalls[1].success({ coords: { latitude: 40.7364, longitude: -73.9832 } });
  assert.deepEqual(requests.find(request => request.url.includes('observations')).body,
    { feature_id: 'test-site', state: 'uncertain', lat: 40.7364, lng: -73.9832 });
  assert.match(status.textContent, /Saved for review/);
  assert.ok(buttons.every(button => !button.disabled));
  await copy.listeners.click();
  assert.match(copyStatus.textContent, /Link copied/);
  for (const request of requests.filter(request => request.url.includes('record-events'))) {
    assert.deepEqual(Object.keys(request.body).sort(), ['event', 'feature_id']);
  }
});
