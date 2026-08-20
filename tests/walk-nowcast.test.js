const test = require('node:test');
const assert = require('node:assert/strict');
const { METHOD_VERSION, localTimeWindow, estimateWalkNowcast } = require('../walk-nowcast');
const { estimatePresence, routingLevel } = require('../condition-model');

const NOW = new Date('2026-08-20T16:00:00Z');

function report(day, hours, count = 1) {
  const latest = Math.max(...hours);
  return { type: 'public_report', at: `${day}T${String(latest).padStart(2, '0')}:30:00-04:00`,
    local_day: day, local_hours: hours, count };
}

test('forecast contract exposes beta probability, uncertainty, and honest labels', () => {
  const events = [
    report('2026-08-14', [7]), report('2026-08-15', [7]), report('2026-08-16', [8]),
    report('2026-08-17', [8]), report('2026-08-18', [9]), report('2026-08-19', [7]),
    report('2026-08-12', [8]), report('2026-08-13', [9]),
    { type: 'observed_encampment', at: '2026-08-19T15:00:00Z' },
  ];
  const result = estimateWalkNowcast(events, NOW, {
    locationUncertaintyM: 35,
    locationMethod: 'NYC 311 address-geocoded coordinate',
  });
  assert.equal(result.method_version, METHOD_VERSION);
  assert.equal(result.contract_version, 'condition-forecast-v1');
  assert.equal(result.rollout, 'shadow');
  assert.equal(result.status, 'beta');
  assert.equal(result.current_probability, result.live_probability);
  assert.equal(result.current_probability, result.uncalibrated_score);
  assert.equal(result.score_semantics, 'uncalibrated_shadow_score');
  assert.equal(result.range_semantics, 'heuristic_score_range_not_confidence_interval');
  assert.ok(result.current_probability > 0 && result.current_probability < 1);
  assert.equal(result.probability_range.length, 2);
  assert.doesNotMatch(result.label, /live/i);
  assert.match(result.basis, /not a field-confirmed live status/i);
  assert.deepEqual(result.spatial_uncertainty, {
    radius_m: 35,
    label: 'Within about 35 m',
    basis: 'NYC 311 address-geocoded coordinate',
  });
  assert.equal(result.local_time_window.label, '7\u201310 AM');
});

test('report timing caps duplicate bursts at one vote per local day per window', () => {
  const events = [
    report('2026-08-12', [7], 80), report('2026-08-13', [7, 7, 8], 50),
    report('2026-08-14', [8]), report('2026-08-15', [9]), report('2026-08-16', [7]),
    report('2026-08-17', [18]), report('2026-08-18', [18]), report('2026-08-19', [18]),
  ].map(event => ({ ...event, at: event.at }));
  const window = localTimeWindow(events.map(event => ({ ...event, at: Date.parse(event.at) })), NOW.getTime());
  assert.equal(window.start_hour, 7);
  assert.equal(window.end_hour, 10);
  assert.equal(window.report_days, 8);
  assert.equal(window.days_in_window, 5);
  assert.equal(window.sample_size, 8);
  assert.equal(window.concentration, 0.63);
  assert.equal(window.strength, 'moderate');
  assert.match(window.basis, /one total unit distributed/i);
  assert.match(window.basis, /not proof of physical presence/i);
});

test('time windows can wrap midnight and are omitted for sparse or diffuse timing', () => {
  const midnight = [
    report('2026-08-11', [23]), report('2026-08-12', [0]), report('2026-08-13', [1]),
    report('2026-08-14', [23]), report('2026-08-15', [0]), report('2026-08-16', [1]),
    report('2026-08-17', [23]), report('2026-08-18', [0]),
  ].map(event => ({ ...event, at: Date.parse(event.at) }));
  const window = localTimeWindow(midnight, NOW.getTime());
  assert.equal(window.start_hour, 23);
  assert.equal(window.end_hour, 2);
  assert.equal(window.label, '11 PM\u20132 AM');

  const sparse = [report('2026-08-17', [7]), report('2026-08-18', [7]), report('2026-08-19', [7])]
    .map(event => ({ ...event, at: Date.parse(event.at) }));
  assert.equal(localTimeWindow(sparse, NOW.getTime()), null);

  const diffuse = Array.from({ length: 8 }, (_, index) => report(`2026-08-${String(11 + index).padStart(2, '0')}`, [index * 3]))
    .map(event => ({ ...event, at: Date.parse(event.at) }));
  assert.equal(localTimeWindow(diffuse, NOW.getTime()), null);
});

test('all-day reports, disconnected ties, and weak patterns do not emit a primary window', () => {
  const everyHour = Array.from({ length: 24 }, (_, hour) => hour);
  const allDay = Array.from({ length: 12 }, (_, index) => report(`2026-08-${String(8 + index).padStart(2, '0')}`, everyHour))
    .map(event => ({ ...event, at: Date.parse(event.at) }));
  assert.equal(localTimeWindow(allDay, NOW.getTime()), null);

  const tied = Array.from({ length: 12 }, (_, index) => report(`2026-08-${String(8 + index).padStart(2, '0')}`, [index % 2 ? 7 : 18]))
    .map(event => ({ ...event, at: Date.parse(event.at) }));
  assert.equal(localTimeWindow(tied, NOW.getTime()), null);

  const weak = Array.from({ length: 8 }, (_, index) => report(`2026-08-${String(11 + index).padStart(2, '0')}`, [index < 3 ? 7 : 10 + index]))
    .map(event => ({ ...event, at: Date.parse(event.at) }));
  assert.equal(localTimeWindow(weak, NOW.getTime()), null);
});

test('NYC-local report hours remain stable across the DST transition', () => {
  const dst = [
    '2026-03-04T12:00:00Z', '2026-03-05T12:00:00Z', '2026-03-06T12:00:00Z', '2026-03-07T12:00:00Z',
    '2026-03-08T11:00:00Z', '2026-03-09T11:00:00Z', '2026-03-10T11:00:00Z', '2026-03-11T11:00:00Z',
  ].map(at => ({ type: 'public_report', at: Date.parse(at) }));
  const window = localTimeWindow(dst, Date.parse('2026-03-12T16:00:00Z'));
  assert.equal(window.label, '6\u20139 AM');
  assert.equal(window.concentration, 1);
  assert.equal(window.strength, 'moderate');
});

test('no-evidence forecast keeps the same nullable contract', () => {
  const result = estimateWalkNowcast([], NOW, { locationUncertaintyM: 45 });
  assert.equal(result.current_probability, null);
  assert.equal(result.local_time_window, null);
  assert.equal(result.spatial_uncertainty.radius_m, 45);
  assert.equal(result.confidence, 'low');
});

test('shadow forecast cannot silently alter hard route exclusions', () => {
  const feature = {
    layer: 'homelessness',
    condition: { routing_level: 'hard', hard_exclusion: true },
    nowcast: { rollout: 'shadow', current_probability: 0.01 },
  };
  assert.equal(routingLevel(feature), 'hard');
  feature.condition = { routing_level: 'none', hard_exclusion: false };
  feature.nowcast.current_probability = 0.99;
  assert.equal(routingLevel(feature), 'none');
});

test('community observation event types cannot alter condition, nowcast, or routing', () => {
  const publicEvents = [report('2026-08-16', [7]), report('2026-08-17', [7]), report('2026-08-18', [7])];
  const poisoned = [...publicEvents,
    { type: 'field_present', at: '2026-08-19T12:00:00Z', count: 1000 },
    { type: 'verified_present', at: '2026-08-19T12:00:00Z', count: 1000 },
    { type: 'field_absent', at: '2026-08-19T13:00:00Z', count: 1000 },
    { type: 'verified_absent', at: '2026-08-19T13:00:00Z', count: 1000 },
  ];
  const baseCondition = estimatePresence(publicEvents, NOW);
  const poisonedCondition = estimatePresence(poisoned, NOW);
  assert.deepEqual(poisonedCondition, baseCondition);
  const baseNowcast = estimateWalkNowcast(publicEvents, NOW);
  const poisonedNowcast = estimateWalkNowcast(poisoned, NOW);
  assert.equal(poisonedNowcast.current_probability, baseNowcast.current_probability);
  assert.equal(poisonedNowcast.confidence, baseNowcast.confidence);
  assert.deepEqual(poisonedNowcast.probability_range, baseNowcast.probability_range);
  assert.equal(routingLevel({ layer: 'homelessness', condition: poisonedCondition }),
    routingLevel({ layer: 'homelessness', condition: baseCondition }));
});
