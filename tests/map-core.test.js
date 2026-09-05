const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pointInGeoJSON, routeIntersectsPoint, featureRisk, scoreRoute, chooseRecommended, plausibleRoutes, exportUrls, simplifyWalkingSteps, isLikelyPresent, LAYER_RADII } = require('../map-core');
const { manufacturer, layerFor, supported, resolutionEvidence, conditionEvidence,
  parseNycWallTime, nycLocalDay, recordReportedLocation, reportedLocationLabel,
  reportedStreetSegmentKey, recordReportedStreetSegment, consolidateReportedLocationSites,
  REPORTED_LOCATION_ENVELOPE_M, REPORTED_STREET_SEGMENT_ENVELOPE_M } = require('../scripts/refresh-map-data');
const { classifyResolution, estimatePresence, routingLevel } = require('../condition-model');

const line = [[-74, 40.7], [-73.99, 40.7]];
const nycBoundary = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'nyc-boroughs.geojson'), 'utf8'));

test('NYC scope uses borough geometry rather than a regional rectangle', () => {
  assert.equal(pointInGeoJSON({ lat: 40.7128, lng: -74.006 }, nycBoundary), true);
  assert.equal(pointInGeoJSON({ lat: 40.7178, lng: -74.0431 }, nycBoundary), false);
  assert.equal(pointInGeoJSON({ lat: 40.8448, lng: -73.8648 }, nycBoundary), true);
});

test('geometry buffers distinguish inside, outside, and degenerate routes', () => {
  assert.equal(routeIntersectsPoint(line, { lat: 40.7001, lng: -73.995 }, 45), true);
  assert.equal(routeIntersectsPoint(line, { lat: 40.701, lng: -73.995 }, 45), false);
  assert.equal(routeIntersectsPoint([[-74, 40.7]], { lat: 40.7, lng: -74 }, 45), false);
  assert.equal(LAYER_RADII.alpr, 45);
  assert.equal(LAYER_RADII.sidewalk, 110);
  assert.equal(LAYER_RADII.homelessness, 55);
  assert.equal(LAYER_RADII.drugs, 110);
});

test('empty awareness filters recommend the fastest route', () => {
  const layers = { alpr: [{ lat: 40.7, lng: -73.995 }] };
  const slower = scoreRoute({ duration: 700, geometry: { coordinates: line } }, layers, []);
  const faster = scoreRoute({ duration: 500, geometry: { coordinates: [[-74, 40.71], [-73.99, 40.71]] } }, layers, []);
  assert.equal(chooseRecommended([slower, faster]), 1);
});

test('walking avoidance never recommends an absurd detour just to reduce crossings', () => {
  const direct = { duration: 1800, distance: 2400, awarenessScore: 8 };
  const reasonable = { duration: 2250, distance: 3000, awarenessScore: 4 };
  const aroundManhattan = { duration: 5400, distance: 11000, awarenessScore: 0 };
  assert.deepEqual(plausibleRoutes([direct, reasonable, aroundManhattan], 'walking'), [direct, reasonable]);
  assert.equal(chooseRecommended([direct, reasonable, aroundManhattan], 'walking'), 1);
});

test('walking directions preserve turns even when the router calls the surface a walkway', () => {
  const generic = [
    ['Walk southwest on the walkway.', 82, 'depart', null],
    ['Turn right onto the walkway.', 15, 'turn', 'right'],
    ['Keep left to take the walkway.', 26, 'turn', 'slight left'],
    ['Turn right onto the walkway.', 41, 'turn', 'right'],
    ['Turn left onto the walkway.', 13, 'turn', 'left'],
    ['Turn right onto the walkway.', 22, 'turn', 'right'],
    ['Turn right onto the walkway.', 10, 'turn', 'right'],
    ['Turn left onto the crosswalk.', 38, 'turn', 'left'],
    ['Turn right onto the crosswalk.', 14, 'turn', 'right'],
    ['Turn left onto the walkway.', 966, 'turn', 'left'],
  ].map(([instruction, distance, type, modifier], index) => ({ instruction, distance, duration: distance, type, modifier, location: { lat: 40.73 + index / 1000, lng: -73.99 } }));
  const simplified = simplifyWalkingSteps([...generic, { instruction: 'You have arrived at your destination.', distance: 0, duration: 0, type: 'arrive' }]);
  assert.equal(simplified.length, 11);
  assert.deepEqual(simplified.slice(0,10), generic);
  assert.equal(simplified.reduce((sum,step)=>sum+step.distance,0), 1227);
  assert.equal(simplified.at(-1).type, 'arrive');
});

test('walking direction cleanup preserves named turns and safety-critical transitions', () => {
  const simplified = simplifyWalkingSteps([
    { instruction: 'Walk west on the walkway.', distance: 420, duration: 300, type: 'depart' },
    { instruction: 'Turn right onto the walkway.', distance: 30, duration: 20, type: 'turn', modifier: 'right' },
    { instruction: 'Turn left onto West 23rd Street.', distance: 260, duration: 180, type: 'turn', modifier: 'left' },
    { instruction: 'Take the stairs to the walkway.', distance: 12, duration: 20, type: 'turn' },
    { instruction: 'You have arrived at your destination.', distance: 0, duration: 0, type: 'arrive' },
  ]);
  assert.deepEqual(simplified.map(step => step.instruction), [
    'Walk west on the walkway.',
    'Turn right onto the walkway.',
    'Turn left onto West 23rd Street.',
    'Take the stairs to the walkway.',
    'You have arrived at your destination.',
  ]);
  assert.equal(simplified[0].distance, 420);
});

test('routing risk weights current evidence above stale or unverified reports', () => {
  const now = Date.parse('2026-08-10T00:00:00Z');
  const present = { layer: 'homelessness', lat: 40.7, lng: -73.995, count: 12, last_seen: '2026-08-08', condition: { classification: 'likely_present' } };
  const unverified = { layer: 'homelessness', lat: 40.7, lng: -73.995, count: 12, last_seen: '2026-08-08', condition: { classification: 'recent_reports_unverified' } };
  const dormant = { layer: 'homelessness', lat: 40.7, lng: -73.995, count: 40, last_seen: '2026-05-01', condition: { classification: 'dormant_unknown' } };
  assert.ok(featureRisk(present, now) > featureRisk(unverified, now));
  assert.ok(featureRisk(unverified, now) > featureRisk(dormant, now));
  const layers = { homelessness: [present, dormant] };
  const direct = scoreRoute({ duration: 1000, distance: 1000, geometry: { coordinates: [[-74, 40.7], [-73.99, 40.7]] } }, layers, ['homelessness']);
  const clean = scoreRoute({ duration: 1200, distance: 1200, geometry: { coordinates: [[-74, 40.71], [-73.99, 40.71]] } }, layers, ['homelessness']);
  assert.ok(direct.riskScore > clean.riskScore);
  assert.equal(chooseRecommended([direct, clean], 'walking'), 1);
});

test('map dots represent only locations currently predicted present', () => {
  assert.equal(isLikelyPresent({ layer: 'homelessness', condition: { classification: 'likely_present' } }), true);
  assert.equal(isLikelyPresent({ layer: 'drugs', condition: { classification: 'recent_reports_unverified' } }), false);
  assert.equal(isLikelyPresent({ layer: 'dumping', condition: { classification: 'likely_absent' } }), false);
  assert.equal(isLikelyPresent({ layer: 'street', condition: { classification: 'dormant_unknown' } }), false);
});

test('driving and walking exports are parseable, mobile-bounded, and honest about shaping', () => {
  const via = { lat: 40.71, lng: -73.98 };
  const urls = exportUrls({ lat: 40.7, lng: -74 }, { lat: 40.72, lng: -73.95 }, [
    [-74, 40.7], [-73.99, 40.705], [-73.98, 40.71], [-73.97, 40.715], [-73.95, 40.72],
  ], 'driving', via);
  const google = new URL(urls.google), apple = new URL(urls.apple);
  assert.equal(google.origin, 'https://www.google.com');
  assert.equal(google.pathname, '/maps/dir/');
  assert.ok((google.searchParams.get('waypoints') || '').split('|').filter(Boolean).length <= 3);
  assert.match(google.searchParams.get('waypoints'), /^40\.710000,-73\.980000/);
  assert.equal(google.searchParams.get('dir_action'), 'navigate');
  assert.equal(google.searchParams.get('travelmode'), 'driving');
  assert.equal(google.searchParams.get('avoid'), 'ferries');
  assert.equal(apple.origin, 'https://maps.apple.com');
  assert.equal(apple.pathname, '/directions');
  assert.equal(apple.searchParams.get('mode'), 'driving');
  assert.equal(apple.searchParams.get('avoid'), 'ferries');
  assert.ok(apple.searchParams.getAll('waypoint').length <= 3);
  assert.ok(urls.shapingWaypoints <= 2);
  assert.equal(urls.includesVia, true);
  const walking = exportUrls({ lat: 40.7, lng: -74 }, { lat: 40.72, lng: -73.95 }, line, 'walking');
  assert.equal(new URL(walking.google).searchParams.get('travelmode'), 'walking');
  assert.equal(new URL(walking.apple).searchParams.get('dirflg'), 'w');
});

test('ALPR vendors and 311 categories use explicit provenance rules', () => {
  assert.equal(manufacturer('flock safety'), 'Flock Safety');
  assert.equal(manufacturer('Vigilant Solutions'), 'Motorola Solutions');
  assert.equal(manufacturer(''), null);
  assert.equal(layerFor('Illegal Dumping'), 'dumping');
  assert.equal(layerFor('Encampment'), 'homelessness');
  assert.equal(layerFor('Drug Activity'), 'drugs');
  assert.equal(layerFor('Dirty Condition'), null);
  assert.equal(supported('dumping', 'Illegal Dumping', 'Chronic Dumping'), true);
  assert.equal(supported('dumping', 'Illegal Dumping', 'Removal Request'), false);
  assert.equal(supported('drugs', 'Drug Activity', 'Use Outside'), true);
});

test('forecast locations retain the newest non-empty 311 address with an honest fallback', () => {
  const site = { _address: null, _addressAt: -Infinity, _borough: null, _boroughAt: -Infinity };
  recordReportedLocation(site, { incident_address: '  100 WEST 23 STREET ', borough: 'MANHATTAN' }, 100);
  recordReportedLocation(site, { incident_address: '', borough: 'MANHATTAN' }, 300);
  recordReportedLocation(site, { incident_address: '90 WEST 23 STREET', borough: 'MANHATTAN' }, 50);
  assert.equal(reportedLocationLabel(site), '100 WEST 23 STREET');
  recordReportedLocation(site, { incident_address: '102 WEST 23 STREET', borough: 'MANHATTAN' }, 400);
  assert.equal(reportedLocationLabel(site), '102 WEST 23 STREET');

  const approximate = { _address: null, _addressAt: -Infinity, _borough: null, _boroughAt: -Infinity };
  recordReportedLocation(approximate, { incident_address: null, borough: 'STATEN ISLAND' }, 100);
  assert.equal(reportedLocationLabel(approximate), 'Approximate reported location in Staten Island');
});

test('nearby address-geocode variants consolidate without chain-merging a block', () => {
  const site = (id, lng, count, day) => ({
    id, lat: 40.75, lng, count, first_seen: `${day}T08:00:00.000`, last_seen: `${day}T08:00:00.000`,
    _address: id, _addressAt: parseNycWallTime(`${day}T08:00:00.000`), _borough: 'MANHATTAN', _boroughAt: 1,
    _reportDays: new Map([[day, { at: parseNycWallTime(`${day}T08:00:00.000`), count, local_hours: new Set([8]) }]]),
    _events: new Map(), _idAliases: new Set([id]), _reportedCoordinateGroups: 1, _maxCoordinateOffsetM: 0,
    _segmentCounts: new Map(), _memberCoordinates: [{ lat: 40.75, lng }],
    responses: { nypd_responded: 0, nypd_observed_encampment: 0, dhs_outreach: 0 },
  });
  const anchor = site('anchor', -73.99, 20, '2026-08-01');
  const nearby = site('nearby', -73.98988, 5, '2026-08-02');
  const chainedOnly = site('chained-only', -73.98972, 4, '2026-08-03');
  const result = consolidateReportedLocationSites([nearby, chainedOnly, anchor], REPORTED_LOCATION_ENVELOPE_M);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'anchor');
  assert.equal(result[0].count, 25);
  assert.deepEqual([...result[0]._idAliases].sort(), ['anchor', 'nearby']);
  assert.equal(result[0]._reportedCoordinateGroups, 2);
  assert.ok(result[0]._maxCoordinateOffsetM > 9 && result[0]._maxCoordinateOffsetM < 11);
  assert.equal(result[1].id, 'chained-only');
});

test('same-block address estimates resolve to one bounded condition without swallowing nearby segments', () => {
  const site = (id, lat, lng, count, address, cross1, cross2) => {
    const item = {
      id, lat, lng, count, first_seen: '2026-01-01T08:00:00.000', last_seen: '2026-08-01T08:00:00.000',
      _address: address, _addressAt: 1, _borough: 'MANHATTAN', _boroughAt: 1,
      _reportDays: new Map(), _events: new Map(), _idAliases: new Set([id]),
      _reportedCoordinateGroups: 1, _maxCoordinateOffsetM: 0, _segmentCounts: new Map(),
      _memberCoordinates: [{ lat, lng }],
      responses: { nypd_responded: 0, nypd_observed_encampment: 0, dhs_outreach: 0 },
    };
    for (let index = 0; index < count; index++) recordReportedStreetSegment(item, {
      incident_address: address, cross_street_1: cross1, cross_street_2: cross2,
    });
    return item;
  };
  const common = ['3 AVENUE', '2 AVENUE'];
  const east246 = site('246', 40.736396, -73.983185, 91, '246 EAST 20 STREET', ...common);
  const east230 = site('230', 40.736484, -73.983394, 30, '230 EAST 20 STREET', ...common);
  const east212 = site('212', 40.736580, -73.983625, 6, '212 EAST 20 STREET', ...common);
  const nextBlock = site('next-block', 40.736650, -73.983800, 5, '200 EAST 21 STREET', '3 AVENUE', '2 AVENUE');
  const result = consolidateReportedLocationSites([east212, nextBlock, east230, east246]);
  assert.equal(REPORTED_STREET_SEGMENT_ENVELOPE_M, 65);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, '246');
  assert.equal(result[0].count, 127);
  assert.equal(result[0]._address, '246 EAST 20 STREET');
  assert.deepEqual([...result[0]._idAliases].sort(), ['212', '230', '246']);
  assert.equal(result[0]._segmentAssistedMerges, 2);
  assert.equal(result[1].id, 'next-block');
});

test('reported street-segment identity normalizes address whitespace, ordinals, and cross-street order', () => {
  const first = reportedStreetSegmentKey({
    incident_address: '230 EAST   20TH ST', cross_street_1: '3 AVE', cross_street_2: '2 AVENUE',
  });
  const second = reportedStreetSegmentKey({
    incident_address: '246 East 20 Street', cross_street_1: '2 Avenue', cross_street_2: '3 Avenue',
  });
  assert.equal(first, second);
});

test('NYC source wall times parse deterministically across standard time, DST, and repeated hours', () => {
  assert.equal(new Date(parseNycWallTime('2026-01-15T12:00:00.000')).toISOString(), '2026-01-15T17:00:00.000Z');
  assert.equal(new Date(parseNycWallTime('2026-07-15T12:00:00.000')).toISOString(), '2026-07-15T16:00:00.000Z');
  assert.equal(new Date(parseNycWallTime('2026-11-01T01:30:00.000')).toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(parseNycWallTime('2026-03-08T02:30:00.000'), null);
  assert.equal(nycLocalDay(Date.parse('2026-08-20T02:00:00Z')), '2026-08-19');
});

test('311 condition evidence requires explicit outcomes or recurrence instead of trusting closure status', () => {
  assert.equal(resolutionEvidence('The condition was corrected without the need to issue a summons.'), 'temporary_action');
  assert.equal(resolutionEvidence('The Police Department visited and observed no encampment.'), 'not_observed');
  assert.equal(resolutionEvidence('The agency closed your Service Request.'), null);
  const ord = value => Math.floor(Date.parse(`${value}T00:00:00Z`) / 86400000);
  const recurred = conditionEvidence({
    reportDays: new Set(['2026-01-01', '2026-03-01', '2026-03-03'].map(ord)),
    lastObserved: 0, lastCleared: Date.parse('2026-02-01T12:00:00Z'), lastNotObserved: 0,
  }, new Date('2026-03-10T00:00:00Z'));
  assert.equal(recurred.classification, 'likely_present');
  assert.equal(recurred.report_days_after_latest_action, 2);
  const recent = conditionEvidence({
    reportDays: new Set(['2026-03-01', '2026-03-04', '2026-03-08'].map(ord)),
    lastObserved: 0, lastCleared: 0, lastNotObserved: 0,
  }, new Date('2026-03-10T00:00:00Z'));
  assert.equal(recent.classification, 'likely_present');
  const cleared = conditionEvidence({
    reportDays: new Set([ord('2026-01-01')]), lastObserved: 0,
    lastCleared: Date.parse('2026-01-02T12:00:00Z'), lastNotObserved: 0,
  }, new Date('2026-04-10T00:00:00Z'));
  assert.equal(cleared.classification, 'likely_cleared');
});

test('encampment presence model separates observation, imperfect detection, and temporary action', () => {
  assert.equal(classifyResolution('Officers observed an encampment at the location.'), 'observed_encampment');
  assert.equal(classifyResolution('The condition was corrected without a summons.'), 'temporary_correction');
  assert.equal(classifyResolution('The person has accepted services.'), 'services_accepted');
  assert.notEqual(classifyResolution('The person has accepted services.'), 'cleanup_reported');
  const now = new Date('2026-08-10T12:00:00Z');
  const observed = estimatePresence([
    { at: '2026-08-10T00:00:00Z', type: 'public_report' },
    { at: '2026-08-10T03:00:00Z', type: 'observed_encampment' },
  ], now);
  const notFound = estimatePresence([
    { at: '2026-08-10T00:00:00Z', type: 'public_report' },
    { at: '2026-08-10T03:00:00Z', type: 'not_observed' },
  ], now);
  assert.ok(observed.presence_probability > notFound.presence_probability);
  assert.equal(observed.routing_level, 'hard');
  assert.equal(notFound.routing_level, 'none');
  assert.equal(routingLevel({ layer: 'homelessness', condition: notFound }), 'none');
});

test('likely absent features never become route hits or hard exclusions', () => {
  const absent = { layer: 'homelessness', lat: 40.7, lng: -73.995, count: 100,
    condition: { classification: 'likely_absent', presence_probability: 0.08, routing_level: 'none' } };
  const route = scoreRoute({ duration: 500, distance: 600, geometry: { coordinates: line } }, { homelessness: [absent] }, ['homelessness']);
  assert.equal(route.metrics.homelessness, 0);
  assert.equal(route.selectedIntersections, 0);
  assert.equal(route.riskScore, 0);
});

test('walking handoffs use compatible endpoint links and separate stop legs, never sampled stops',()=>{
  const start={lat:40.75,lng:-73.99},stop={name:'Coffee',lat:40.74,lng:-73.98},end={lat:40.73,lng:-73.97};
  const handoff=exportUrls(start,end,[[-73.99,40.75],[-73.95,40.76],[-73.97,40.73]],'walking',stop);
  assert.equal(handoff.shapingWaypoints,0);assert.equal(handoff.includesVia,false);assert.equal(handoff.legs.length,2);
  for(const leg of handoff.legs){
    const apple=new URL(leg.apple),google=new URL(leg.google);
    assert.equal(apple.pathname,'/');assert.equal(apple.searchParams.get('dirflg'),'w');
    assert.equal(google.searchParams.get('api'),'1');assert.equal(google.searchParams.get('travelmode'),'walking');
    assert.equal(apple.searchParams.get('saddr'),google.searchParams.get('origin'));
    assert.equal(apple.searchParams.get('daddr'),google.searchParams.get('destination'));
    assert.equal(google.searchParams.has('waypoints'),false);assert.equal(apple.searchParams.has('waypoint'),false);
  }
  assert.equal(new URL(handoff.legs[0].google).searchParams.get('destination'),'40.740000,-73.980000');
  assert.equal(new URL(handoff.legs[1].google).searchParams.get('origin'),'40.740000,-73.980000');
  assert.equal(new URL(handoff.legs[1].google).searchParams.get('destination'),'40.730000,-73.970000');
});
test('long walking instructions retain the first movement, repeated turns and final arrival',()=>{
  const steps=[{instruction:'Walk north on the walkway.',distance:12,duration:10,type:'depart'},
    ...Array.from({length:90},(_,i)=>({instruction:'Turn left onto the walkway.',distance:20,duration:15,type:'turn',modifier:'left',location:{lat:40.7+i*.0001,lng:-73.9}})),
    {instruction:'You have arrived at your destination.',distance:0,duration:0,type:'arrive'}];
  const result=simplifyWalkingSteps(steps);
  assert.deepEqual(result,steps);assert.equal(result.length,92);assert.equal(result.at(-1).type,'arrive');
});
