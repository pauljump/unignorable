#!/usr/bin/env node
// Build the compact NYC map artifact from public sources. Failed upstreams preserve the last
// successful layer instead of replacing it with an empty result.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { pointInGeoJSON } = require('../map-core');
const { classifyResolution, estimatePresence, METHOD_VERSION } = require('../condition-model');
const { estimateWalkNowcast, METHOD_VERSION: WALK_NOWCAST_METHOD_VERSION } = require('../walk-nowcast');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const OUT = path.join(DATA_DIR, 'map-layers.json');
const NYC_BOUNDARY = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'nyc-boroughs.geojson'), 'utf8'));
const UA = 'unignorable/2.0 (NYC civic-condition map; +https://unignorable.polyfeeds.dev)';
const NYC_BBOX = '40.4774,-74.2591,40.9176,-73.7004';
const SOCRATA = 'https://data.cityofnewyork.us/resource/erm2-nwe9.json';
const OVERPASS_URLS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const REGISTRY = Object.freeze({
  homelessness: {
    'Encampment': ['N/A'],
    'Homeless Person Assistance': ['Chronic', 'Non-Chronic'],
  },
  drugs: { 'Drug Activity': ['Use Outside', 'Use Indoor'] },
  dumping: { 'Illegal Dumping': ['Chronic Dumping'] },
  sidewalk: { 'Sidewalk Condition': ['Broken Sidewalk', 'Blocked - Construction', 'Pedestrian Ramp Defective', 'Sidewalk Collapsed', 'Defective Hardware', 'Sidewalk Grating - Defective', 'Sidewalk Grating - Missing', 'Cellar Door Open/Unprotected', 'Cellar Door Defective', 'Metal Protruding - Sign Stump', 'Unsafe Worksite'] },
  street: { 'Street Condition': ['Pothole', 'Cave-in', 'Defective Hardware', 'Blocked - Construction', 'Failed Street Repair', 'Rough, Pitted or Cracked Roads', 'Plate Condition - Shifted', 'Plate Condition - Open', 'Crash Cushion Defect', 'Guard Rail - Street', 'Unsafe Worksite'] },
  signals: {
    'Street Light Condition': ['Street Light Out', 'Multiple Street Lights Out', 'Lamppost Knocked Down', 'Fixture/Luminaire Hanging', 'Lamppost Wire Exposed', 'Lamppost Damaged', 'Street Light Lamp Dim', 'Lamppost Leaning', 'Lamppost Missing', 'Street Light Lamp Missing', 'Fixture/Luminaire Damaged', 'Fixture/Luminaire Missing'],
    'Traffic Signal Condition': ['Pedestrian Signal', 'APS', 'LED Pedestrian Unit', 'Ped Lamp', 'Ped Multiple Lamps', 'Push Button', 'Ped Flasher', 'Ped Lens', 'Ped Visor', 'Pedestrian Sign'],
  },
});
const LAYER_NAMES = Object.freeze(['homelessness', 'drugs', 'dumping', 'sidewalk', 'street', 'signals']);
const RESPONSE_TYPES = new Set(['Encampment', 'Homeless Person Assistance', 'Drug Activity']);
const TYPES = [...new Set(Object.values(REGISTRY).flatMap(byType => Object.keys(byType)))];
const MIN_REPORTS = 5, MIN_SPAN_DAYS = 30, RECENT_DAYS = 180, LOOKBACK_YEARS = 5;
const REPORTED_LOCATION_ENVELOPE_M = 20;
const REPORTED_STREET_SEGMENT_ENVELOPE_M = 65;
const SIDEWALK_DB = process.env.DB || path.join(process.env.SIDEWALK_DIR || '/Users/mini-home/Desktop/Monorepo/sidewalk', 'data', 'sidewalk.db');
const NYC_WALL_FORMATTER = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const NYC_OFFSET_FORMATTER = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' });

function nycParts(timestamp) {
  return Object.fromEntries(NYC_WALL_FORMATTER.formatToParts(new Date(timestamp))
    .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function nycOffsetMs(timestamp) {
  const name = NYC_OFFSET_FORMATTER.formatToParts(new Date(timestamp)).find(part => part.type === 'timeZoneName')?.value || '';
  const match = name.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

// Socrata's NYC timestamps are wall times with no offset. Resolve them explicitly against the
// IANA timezone, choose the earlier instant during the repeated fall-back hour, and reject the
// nonexistent spring-forward hour rather than silently shifting its day or time.
function parseNycWallTime(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const wanted = { year: match[1], month: match[2], day: match[3], hour: match[4], minute: match[5], second: match[6] };
  const millis = Number((match[7] || '').padEnd(3, '0'));
  const wallUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]), millis);
  const offsets = new Set([nycOffsetMs(wallUtc - 12 * 3_600_000), nycOffsetMs(wallUtc), nycOffsetMs(wallUtc + 12 * 3_600_000)]);
  const matches = [...offsets].filter(Number.isFinite).map(offset => wallUtc - offset).filter(timestamp => {
    const actual = nycParts(timestamp);
    return Object.entries(wanted).every(([key, expected]) => actual[key] === expected);
  });
  return matches.length ? Math.min(...matches) : null;
}

function nycLocalDay(timestamp) {
  const parts = nycParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function resolutionEvidence(value = '') {
  const kind = classifyResolution(value, 'Encampment');
  if (kind === 'observed_encampment' || kind === 'person_contact') return 'observed';
  if (kind === 'cleanup_reported') return 'cleared';
  if (kind === 'not_observed') return 'not_observed';
  if (kind === 'temporary_correction') return 'temporary_action';
  if (kind === 'services_accepted') return 'services_accepted';
  return kind;
}

const dayNumber = value => Math.floor(Date.parse(String(value).slice(0, 10) + 'T00:00:00Z') / 86400000);
const isoDay = value => new Date(value * 86400000).toISOString().slice(0, 10);
const median = values => { const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1; return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
function conditionEvidence(timeline, now = new Date()) {
  const days = [...timeline.reportDays].sort((a, b) => a - b);
  if (!days.length) return { classification: 'unknown', label: 'Current status unknown', basis: 'No event-level timeline was available.' };
  const gaps = days.slice(1).map((day, index) => day - days[index]);
  const quietWindow = Math.round(Math.min(90, Math.max(30, gaps.length ? median(gaps) * 4 : 90)));
  let episodes = 1;for(const gap of gaps)if(gap>quietWindow)episodes++;
  const nowDay = dayNumber(nycLocalDay(now.getTime())),lastReportDay=days[days.length-1],silence=Math.max(0,nowDay-lastReportDay);
  const recentReportDays14 = days.filter(day => day >= nowDay - 13).length;
  const recentReportDays30 = days.filter(day => day >= nowDay - 29).length;
  const terminal = Math.max(timeline.lastCleared || 0, timeline.lastNotObserved || 0);
  const terminalDay = terminal ? dayNumber(nycLocalDay(terminal)) : 0;
  const reportsAfterAction = terminalDay ? days.filter(day => day > terminalDay).length : 0;
  const observedNewer = timeline.lastObserved && timeline.lastObserved > terminal;
  let classification='recent_reports_unverified',label='Recently reported; not agency-confirmed',basis='Recent 311 reports exist, but the latest agency disposition does not establish that the condition remains.';
  const activeRecentReports = (!terminal || reportsAfterAction > 0) && (silence <= 7 || recentReportDays14 >= 2 || (silence <= 14 && recentReportDays30 >= 3));
  if(observedNewer && nowDay-dayNumber(nycLocalDay(timeline.lastObserved))<=quietWindow){classification='likely_present';label='Current condition likely present';basis='An agency response recently observed the condition, and the location has not exceeded its adaptive quiet window.';}
  else if(terminal && reportsAfterAction>=2 && silence<=quietWindow){classification='likely_present';label='Reported again after agency action';basis=`Reports returned on ${reportsAfterAction} distinct days after the latest clearance or no-condition response.`;}
  else if(activeRecentReports){classification='likely_present';label='Current condition likely present';basis='Recent recurring reports indicate the condition is likely still present; this is an inference, not live proof.';}
  else if(timeline.lastCleared && timeline.lastCleared>=Date.parse(isoDay(lastReportDay)) && nowDay-dayNumber(nycLocalDay(timeline.lastCleared))>quietWindow){classification='likely_cleared';label='Likely cleared; no later reports';basis='The agency explicitly recorded corrective action, followed by a full location-specific quiet window with no later report day.';}
  else if(timeline.lastNotObserved && timeline.lastNotObserved>=Date.parse(isoDay(lastReportDay)) && nowDay-dayNumber(nycLocalDay(timeline.lastNotObserved))>quietWindow){classification='likely_absent';label='Not found; no later reports';basis='The agency explicitly did not observe the condition, followed by a full location-specific quiet window with no later report day.';}
  else if(silence>quietWindow){classification='dormant_unknown';label='Quiet now; outcome unknown';basis='Reports stopped for longer than this location’s normal recurrence window, but no explicit corrective outcome proves why.';}
  return {classification,label,basis,last_report_at:isoDay(lastReportDay),silence_days:silence,quiet_window_days:quietWindow,episode_count:episodes,report_days_after_latest_action:reportsAfterAction,last_observed_at:timeline.lastObserved?new Date(timeline.lastObserved).toISOString():null,last_cleared_at:timeline.lastCleared?new Date(timeline.lastCleared).toISOString():null,last_not_observed_at:timeline.lastNotObserved?new Date(timeline.lastNotObserved).toISOString():null,method_version:'311-condition-evidence-v1'};
}

function enrichConditionEvidence(merged) {
  for (const item of merged.values()) item._timeline = { reportDays: new Set(), lastObserved: 0, lastCleared: 0, lastNotObserved: 0 };
  if (fs.existsSync(SIDEWALK_DB)) {
    const db = new DatabaseSync(SIDEWALK_DB, { readOnly: true });
    const query = db.prepare(`SELECT complaint_type, descriptor, round(cast(latitude AS real),3) AS lat, round(cast(longitude AS real),3) AS lng,
      created_date, coalesce(resolution_action_updated_date,closed_date,created_date) AS action_at, resolution_description
      FROM sr311 WHERE complaint_type=? AND created_date>=? AND latitude IS NOT NULL AND longitude IS NOT NULL`);
    const since = new Date(Date.now() - LOOKBACK_YEARS * 365 * 86400000).toISOString().slice(0, 10);
    for (const type of TYPES) {
      const layer = layerFor(type);if(!layer)continue;
      for (const row of query.iterate(type, since)) {
        if(!supported(layer,type,row.descriptor||''))continue;
        const lat=Number(row.lat),lng=Number(row.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
        const item=merged.get(`${layer}|${lat.toFixed(3)}|${lng.toFixed(3)}`);if(!item)continue;
        const day=dayNumber(row.created_date);if(Number.isFinite(day))item._timeline.reportDays.add(day);
        const kind=resolutionEvidence(row.resolution_description),action=parseNycWallTime(row.action_at||row.created_date);
        if(kind&&Number.isFinite(action)){if(kind==='observed')item._timeline.lastObserved=Math.max(item._timeline.lastObserved,action);if(kind==='cleared')item._timeline.lastCleared=Math.max(item._timeline.lastCleared,action);if(kind==='not_observed')item._timeline.lastNotObserved=Math.max(item._timeline.lastNotObserved,action);}
      }
    }
    db.close();
  }
  for (const item of merged.values()) {
    // The direct Socrata aggregate can be a few hours newer than the local mirror. Always merge
    // its boundary dates so a fresh report can veto a stale “cleared” inference.
    const first=dayNumber(item.first_seen),last=dayNumber(item.last_seen);if(Number.isFinite(first))item._timeline.reportDays.add(first);if(Number.isFinite(last))item._timeline.reportDays.add(last);
    item.condition=conditionEvidence(item._timeline);
    if(item.condition.last_report_at && (!item.last_seen || item.condition.last_report_at>String(item.last_seen).slice(0,10))) item.last_seen=`${item.condition.last_report_at}T00:00:00.000`;
    delete item._timeline;
  }
}

function readExisting() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); }
  catch { return { meta: {}, layers: { alpr: [], ...Object.fromEntries(LAYER_NAMES.map(name => [name, []])) } }; }
}

function manufacturer(value = '') {
  const normalized = String(value).trim().toLowerCase();
  if (normalized.includes('flock')) return 'Flock Safety';
  if (normalized.includes('motorola') || normalized.includes('vigilant')) return 'Motorola Solutions';
  if (normalized.includes('genetec')) return 'Genetec';
  if (normalized.includes('leonardo') || normalized.includes('elsag')) return 'Leonardo / ELSAG';
  if (normalized.includes('axon')) return 'Axon';
  return value ? String(value).trim() : null;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { accept: 'application/json', 'user-agent': UA, ...(options.headers || {}) }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${(await response.text()).slice(0, 180)}`);
  return response.json();
}

async function refreshAlpr() {
  const query = `[out:json][timeout:90];node["surveillance:type"="ALPR"](${NYC_BBOX});out tags center;`;
  let payload = null, lastError = null;
  for (const endpoint of OVERPASS_URLS) {
    try {
      payload = await fetchJson(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}` });
      break;
    } catch (error) { lastError = error; }
  }
  if (!payload) throw lastError || new Error('all Overpass mirrors failed');
  return (payload.elements || []).map(node => {
    const tags = node.tags || {};
    const lat = Number(node.lat ?? node.center?.lat), lng = Number(node.lon ?? node.center?.lon);
    return {
      id: `osm-node-${node.id}`, layer: 'alpr', lat, lng,
      manufacturer: manufacturer(tags.manufacturer), manufacturer_raw: tags.manufacturer || null,
      operator: tags.operator || null, operator_type: tags['operator:type'] || null,
      observed_at: tags.check_date || tags.survey_date || node.timestamp || null,
      source: 'OpenStreetMap', source_url: `https://www.openstreetmap.org/node/${node.id}`,
    };
  }).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng) && pointInGeoJSON(item, NYC_BOUNDARY));
}

function layerFor(type) {
  return Object.keys(REGISTRY).find(layer => Object.hasOwn(REGISTRY[layer], type)) || null;
}

function supported(layer, type, descriptor) {
  return !!(REGISTRY[layer] && REGISTRY[layer][type] && REGISTRY[layer][type].includes(descriptor));
}

function isoDaysAgo(days) { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) + 'T00:00:00.000'; }

const cleanLocationText = value => String(value || '').trim().replace(/\s+/g, ' ');
const titleCase = value => cleanLocationText(value).toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());

function recordReportedLocation(item, row, createdAt) {
  const address = cleanLocationText(row.incident_address);
  const borough = cleanLocationText(row.borough);
  if (address && (createdAt > item._addressAt || (createdAt === item._addressAt && address.localeCompare(item._address || '') > 0))) {
    item._address = address; item._addressAt = createdAt;
  }
  if (borough && (createdAt > item._boroughAt || (createdAt === item._boroughAt && borough.localeCompare(item._borough || '') > 0))) {
    item._borough = borough; item._boroughAt = createdAt;
  }
}

function reportedLocationLabel(item) {
  if (item._address) return item._address;
  const borough = titleCase(item._borough);
  return borough ? `Approximate reported location in ${borough}` : 'Approximate reported location';
}

function normalizeStreetName(value) {
  return cleanLocationText(value).toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, ' ')
    .replace(/\b(\d+)(?:ST|ND|RD|TH)\b/g, '$1')
    .replace(/\bST\b/g, 'STREET').replace(/\bAVE\b/g, 'AVENUE')
    .replace(/\bRD\b/g, 'ROAD').replace(/\bBLVD\b/g, 'BOULEVARD')
    .replace(/\bPL\b/g, 'PLACE').replace(/\bPKWY\b/g, 'PARKWAY')
    .replace(/\s+/g, ' ').trim();
}

// NYC associates reports with standard address locations. A reporter choosing 212, 230, or 246
// on the same block can therefore describe one condition while producing separate coordinates.
// The street plus its two bounding cross streets is stronger identity evidence than proximity
// alone, while the fixed 65 m diameter prevents a shared block label from swallowing the block.
function reportedStreetSegmentKey(row) {
  const incident = normalizeStreetName(row.incident_address);
  const street = incident.replace(/^\d+(?:-\d+)?[A-Z]?\s+/, '').trim();
  const cross = [normalizeStreetName(row.cross_street_1), normalizeStreetName(row.cross_street_2)]
    .filter(Boolean).sort();
  if (!street || cross.length !== 2 || cross[0] === cross[1]) return null;
  return `${street}|${cross[0]}<>${cross[1]}`;
}

function recordReportedStreetSegment(item, row) {
  const key = reportedStreetSegmentKey(row);
  if (!key) return;
  item._segmentCounts.set(key, (item._segmentCounts.get(key) || 0) + 1);
}

function dominantReportedStreetSegments(item) {
  const counts = item._segmentCounts || new Map();
  const total = Number(item.count) || [...counts.values()].reduce((sum, value) => sum + value, 0);
  if (!total) return new Set();
  return new Set([...counts].filter(([, count]) => count / total > 0.5).map(([key]) => key));
}

function reportedLocationBucket(point, cellSizeM) {
  const metersPerDegree = 111000;
  const projectedX = Number(point.lng) * metersPerDegree * Math.cos(40.7 * Math.PI / 180);
  const projectedY = Number(point.lat) * metersPerDegree;
  return [Math.floor(projectedX / cellSizeM), Math.floor(projectedY / cellSizeM)];
}

function reportedLocationDistanceMeters(a, b) {
  const rad = Math.PI / 180, lat1 = Number(a.lat) * rad, lat2 = Number(b.lat) * rad;
  const dLat = (Number(b.lat) - Number(a.lat)) * rad, dLng = (Number(b.lng) - Number(a.lng)) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function mergeReportedLocationSite(target, source, { preserveAnchorAddress = false } = {}) {
  const offset = reportedLocationDistanceMeters(target, source);
  target.count += source.count;
  if (!target.first_seen || source.first_seen < target.first_seen) target.first_seen = source.first_seen;
  if (!target.last_seen || source.last_seen > target.last_seen) target.last_seen = source.last_seen;
  if (!preserveAnchorAddress && source._address && source._addressAt > target._addressAt) {
    target._address = source._address; target._addressAt = source._addressAt;
  }
  if (source._borough && source._boroughAt > target._boroughAt) {
    target._borough = source._borough; target._boroughAt = source._boroughAt;
  }
  for (const [day, incoming] of source._reportDays) {
    const current = target._reportDays.get(day);
    if (!current) target._reportDays.set(day, incoming);
    else {
      current.at = Math.max(current.at, incoming.at); current.count += incoming.count;
      for (const hour of incoming.local_hours) current.local_hours.add(hour);
    }
  }
  for (const [eventKey, incoming] of source._events) {
    const current = target._events.get(eventKey);
    if (!current) target._events.set(eventKey, incoming);
    else { current.at = Math.max(current.at, incoming.at); current.count += incoming.count; }
  }
  for (const name of Object.keys(target.responses)) target.responses[name] += Number(source.responses[name]) || 0;
  for (const id of source._idAliases) target._idAliases.add(id);
  for (const [key, count] of source._segmentCounts || []) {
    target._segmentCounts.set(key, (target._segmentCounts.get(key) || 0) + count);
  }
  for (const point of source._memberCoordinates || [{ lat: source.lat, lng: source.lng }]) target._memberCoordinates.push(point);
  target._reportedCoordinateGroups += source._reportedCoordinateGroups;
  target._maxCoordinateOffsetM = Math.max(target._maxCoordinateOffsetM, source._maxCoordinateOffsetM, offset);
  return target;
}

// Public 311 coordinates are address geocodes with more uncertainty than their decimal precision
// implies. Consolidate very close variants into one bounded reported-location envelope. Anchors are
// chosen by evidence volume and never move while assigning neighbors, preventing DBSCAN-style
// chain merging from turning a sequence of nearby reports into one whole-block site.
function consolidateReportedLocationSites(input, radiusM = REPORTED_LOCATION_ENVELOPE_M) {
  const ordered = [...input].sort((a, b) => Number(b.count) - Number(a.count)
    || parseNycWallTime(b.last_seen) - parseNycWallTime(a.last_seen) || String(a.id).localeCompare(String(b.id)));
  for (const site of ordered) {
    site._segmentCounts ||= new Map();
    site._anchorSegmentKeys = dominantReportedStreetSegments(site);
    site._memberCoordinates ||= [{ lat: site.lat, lng: site.lng }];
    site._segmentAssistedMerges ||= 0;
    site._matchedSegmentKeys ||= new Set();
  }
  const envelopes = [];
  const searchCellM = Math.max(radiusM, REPORTED_STREET_SEGMENT_ENVELOPE_M);
  const buckets = new Map();
  for (const site of ordered) {
    let best = null, bestDistance = Infinity;
    const [siteX, siteY] = reportedLocationBucket(site, searchCellM);
    const candidates = new Set();
    // Two cells absorb the small equirectangular approximation at NYC's north/south extremes.
    for (let x = siteX - 2; x <= siteX + 2; x += 1) for (let y = siteY - 2; y <= siteY + 2; y += 1) {
      for (const envelope of buckets.get(`${x}|${y}`) || []) candidates.add(envelope);
    }
    for (const envelope of [...candidates].sort((a, b) => a._envelopeOrder - b._envelopeOrder)) {
      const distance = reportedLocationDistanceMeters(envelope, site);
      const sharedSegment = [...envelope._anchorSegmentKeys].find(key => site._anchorSegmentKeys.has(key));
      const segmentDiameterOk = sharedSegment && envelope._memberCoordinates.every(point =>
        reportedLocationDistanceMeters(point, site) <= REPORTED_STREET_SEGMENT_ENVELOPE_M);
      const nearbyVariant = distance <= radiusM;
      const sameBoundedSegment = distance <= REPORTED_STREET_SEGMENT_ENVELOPE_M && segmentDiameterOk;
      if ((nearbyVariant || sameBoundedSegment) && distance < bestDistance) {
        best = envelope; bestDistance = distance;
        site._matchedEnvelopeSegment = sameBoundedSegment ? sharedSegment : null;
      }
    }
    if (best) {
      if (site._matchedEnvelopeSegment && bestDistance > radiusM) {
        best._segmentAssistedMerges += 1;
        best._matchedSegmentKeys.add(site._matchedEnvelopeSegment);
      }
      mergeReportedLocationSite(best, site, { preserveAnchorAddress: bestDistance > radiusM });
    }
    else {
      site._envelopeOrder = envelopes.length;
      envelopes.push(site);
      const [x, y] = reportedLocationBucket(site, searchCellM), key = `${x}|${y}`;
      const bucket = buckets.get(key) || [];
      bucket.push(site); buckets.set(key, bucket);
    }
  }
  return envelopes;
}

function locationResolutionAudit(features = []) {
  return {
    version: 'reported-location-envelope-v2',
    canonical_sites: features.length,
    reported_coordinate_groups: features.reduce((sum, feature) =>
      sum + (Number(feature.location_identity?.reported_coordinate_groups) || 1), 0),
    street_segment_assisted_sites: features.filter(feature =>
      Number(feature.location_identity?.street_segment_assisted_merges) > 0).length,
    street_segment_assisted_merges: features.reduce((sum, feature) =>
      sum + (Number(feature.location_identity?.street_segment_assisted_merges) || 0), 0),
    max_coordinate_offset_m: features.reduce((max, feature) =>
      Math.max(max, Number(feature.location_identity?.max_coordinate_offset_m) || 0), 0),
  };
}

function buildEncampmentSites(now = new Date()) {
  if (!fs.existsSync(SIDEWALK_DB)) return null;
  const db = new DatabaseSync(SIDEWALK_DB, { readOnly: true });
  const since = new Date(now.getTime() - LOOKBACK_YEARS * 365 * 86400000).toISOString().slice(0, 10);
  const query = db.prepare(`SELECT unique_key,created_date,closed_date,agency,status,resolution_description,
    resolution_action_updated_date,incident_address,cross_street_1,cross_street_2,borough,
    cast(latitude AS real) lat,cast(longitude AS real) lng
    FROM sr311 WHERE complaint_type='Encampment' AND created_date>=? AND latitude IS NOT NULL AND longitude IS NOT NULL
    ORDER BY created_date`);
  const sites = new Map();
  for (const row of query.iterate(since)) {
    const lat = Number(row.lat), lng = Number(row.lng), createdAt = parseNycWallTime(row.created_date);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(createdAt)) continue;
    // Four decimal places are roughly 11 m north/south and 8 m east/west in NYC. The point still
    // carries a wider uncertainty radius because 311 publishes an address geocode, not a GPS fix.
    const roundedLat = Number(lat.toFixed(4)), roundedLng = Number(lng.toFixed(4));
    const key = `${roundedLat.toFixed(4)}|${roundedLng.toFixed(4)}`;
    const siteId = `311-encampment-${roundedLat.toFixed(4)}-${roundedLng.toFixed(4)}`;
    const item = sites.get(key) || {
      id: siteId,
      layer: 'homelessness', subject_type: 'encampment', lat, lng, count: 0,
      first_seen: null, last_seen: null, _reportDays: new Map(), _events: new Map(),
      _address: null, _addressAt: -Infinity, _borough: null, _boroughAt: -Infinity,
      _idAliases: new Set([siteId]), _reportedCoordinateGroups: 1, _maxCoordinateOffsetM: 0,
      _segmentCounts: new Map(), _memberCoordinates: [{ lat, lng }],
      responses: { nypd_responded: 0, nypd_observed_encampment: 0, dhs_outreach: 0 },
    };
    item.count += 1;
    if (!item.first_seen || row.created_date < item.first_seen) item.first_seen = row.created_date;
    if (!item.last_seen || row.created_date > item.last_seen) {
      item.last_seen = row.created_date; item.lat = lat; item.lng = lng;
    }
    recordReportedLocation(item, row, createdAt);
    recordReportedStreetSegment(item, row);
    // NYC Open Data timestamps are local wall times without an offset. Preserve the source day
    // and hour explicitly for the report-timing window instead of letting the host timezone shift
    // them. One report-day event still feeds the presence model, preserving its dedupe semantics.
    const localDay = String(row.created_date).slice(0, 10);
    const localHour = Number(String(row.created_date).slice(11, 13));
    const day = /^\d{4}-\d{2}-\d{2}$/.test(localDay) ? localDay : new Date(createdAt).toISOString().slice(0, 10);
    const report = item._reportDays.get(day) || { at: createdAt, count: 0, local_day: day, local_hours: new Set() };
    report.at = Math.max(report.at, createdAt); report.count += 1;
    if (Number.isInteger(localHour) && localHour >= 0 && localHour <= 23) report.local_hours.add(localHour);
    item._reportDays.set(day, report);

    const text = String(row.resolution_description || '');
    const kind = classifyResolution(text, 'Encampment');
    if (kind) {
      let actionAt = parseNycWallTime(row.resolution_action_updated_date || row.closed_date || row.created_date);
      if (!Number.isFinite(actionAt) || actionAt < createdAt - 3600000) actionAt = createdAt;
      const eventDay = nycLocalDay(actionAt);
      const eventKey = `${eventDay}|${kind}`;
      const event = item._events.get(eventKey) || { type: kind, at: actionAt, count: 0 };
      event.at = Math.max(event.at, actionAt); event.count += 1; item._events.set(eventKey, event);
    }
    const lower = text.toLowerCase(), agency = String(row.agency || '').toUpperCase();
    if (agency === 'NYPD' && (lower.includes('police department responded') || lower.includes('responding officers'))) item.responses.nypd_responded += 1;
    if (kind === 'observed_encampment') item.responses.nypd_observed_encampment += 1;
    if (agency === 'DHS' && (lower.includes('outreach response team') || lower.includes('dhs outreach team') || lower.includes('department of homeless services (dhs) visited'))) item.responses.dhs_outreach += 1;
    sites.set(key, item);
  }
  db.close();

  const output = [];
  for (const item of consolidateReportedLocationSites(sites.values())) {
    if (!pointInGeoJSON(item, NYC_BOUNDARY)) continue;
    const events = [
      ...[...item._reportDays.values()].map(report => ({ type: 'public_report', ...report, local_hours: [...report.local_hours] })),
      ...item._events.values(),
    ];
    const condition = estimatePresence(events, now);
    // Shadow only: it is exposed for app experimentation and offline evaluation, but condition
    // remains the sole source for map inclusion and route avoidance. No promotion path exists
    // until an independently audited held-out label set and evaluation protocol are established.
    const locationUncertaintyM = Math.min(65, (item._address ? 35 : 45) + Math.ceil(item._maxCoordinateOffsetM));
    const locationMethod = item._segmentAssistedMerges > 0
      ? 'NYC 311 address geocodes sharing a reported street segment consolidated into a bounded location envelope'
      : item._reportedCoordinateGroups > 1
      ? 'Nearby NYC 311 address geocodes consolidated into a bounded reported-location envelope'
      : 'NYC 311 address-geocoded reported location';
    const nowcast = estimateWalkNowcast(events, now, { locationUncertaintyM, locationMethod });
    const lastAgeDays = Math.max(0, (now.getTime() - parseNycWallTime(item.last_seen)) / 86400000);
    // Old, low-probability locations are neither useful map points nor route constraints. Keep
    // fresh negative checks briefly so the UI can explain why a recent report is not being avoided.
    if (lastAgeDays > 120 || (lastAgeDays > 30 && condition.routing_level === 'none')) continue;
    const distinctReportDays = item._reportDays.size;
    output.push({
      id: item.id, layer: item.layer, subject_type: item.subject_type,
      lat: item.lat, lng: item.lng, count: item.count, distinct_report_days: distinctReportDays,
      address: reportedLocationLabel(item),
      complaint_type: 'Encampment', descriptor: condition.label,
      first_seen: item.first_seen, last_seen: item.last_seen, responses: item.responses,
      condition,
      nowcast,
      location_uncertainty_m: locationUncertaintyM,
      location_method: locationMethod,
      id_aliases: [...item._idAliases].filter(id => id !== item.id).sort(),
      location_identity: {
        semantics: 'reported_location_envelope_not_physical_instance',
        reported_coordinate_groups: item._reportedCoordinateGroups,
        consolidation_radius_m: REPORTED_LOCATION_ENVELOPE_M,
        near_coordinate_radius_m: REPORTED_LOCATION_ENVELOPE_M,
        street_segment_radius_m: REPORTED_STREET_SEGMENT_ENVELOPE_M,
        street_segment_assisted_merges: item._segmentAssistedMerges,
        matched_street_segments: item._matchedSegmentKeys.size,
        max_coordinate_offset_m: Math.round(item._maxCoordinateOffsetM),
        chain_merging: false,
      },
      source: 'NYC 311', source_url: 'https://data.cityofnewyork.us/d/erm2-nwe9',
    });
  }
  return output.sort((a, b) => Number(b.condition.presence_probability || 0) - Number(a.condition.presence_probability || 0)
    || parseNycWallTime(b.last_seen) - parseNycWallTime(a.last_seen));
}

async function refresh311() {
  const lookback = isoDaysAgo(LOOKBACK_YEARS * 365), recent = isoDaysAgo(RECENT_DAYS);
  // One giant GROUP BY over every supported family regularly exceeds Socrata's query timeout.
  // Keep each request selective by filtering one complaint type and its exact descriptor allowlist
  // before aggregation. Five small queries are both faster and less work for NYC Open Data.
  const rows = [];
  const appHeaders = process.env.NYC_OPEN_DATA_APP_TOKEN ? { 'x-app-token': process.env.NYC_OPEN_DATA_APP_TOKEN } : {};
  // The local daily mirror supplies address-level encampment timelines. Do not mix its precise
  // latent-state estimates with broad Homeless Person Assistance reports about individuals.
  const localEncampments = buildEncampmentSites();
  const remoteTypes = TYPES.filter(type => type !== 'Homeless Person Assistance' && !(localEncampments && type === 'Encampment'));
  for (const type of remoteTypes) {
    const descriptors = Object.values(REGISTRY)
      .flatMap(byType => byType[type] || [])
      .map(value => `'${value.replaceAll("'", "''")}'`).join(',');
    const safeType = type.replaceAll("'", "''");
    const params = new URLSearchParams({
      '$select': 'complaint_type,descriptor,round(latitude,3) as lat,round(longitude,3) as lng,count(*) as count,min(created_date) as first_seen,max(created_date) as last_seen',
      '$where': `created_date >= '${lookback}' AND complaint_type='${safeType}' AND descriptor in(${descriptors}) AND latitude is not null AND longitude is not null`,
      '$group': 'complaint_type,descriptor,round(latitude,3),round(longitude,3)',
      '$having': `count(*) >= ${MIN_REPORTS} AND max(created_date) >= '${recent}'`,
      '$limit': '50000',
    });
    rows.push(...await fetchJson(`${SOCRATA}?${params}`, { headers: appHeaders }));
  }
  const layers = Object.fromEntries(LAYER_NAMES.map(name => [name, []]));
  const merged = new Map();
  for (const row of rows) {
    const type = row.complaint_type, layer = layerFor(type);
    const lat = Number(row.lat), lng = Number(row.lng), count = Number(row.count);
    const descriptor = row.descriptor || '';
    const spanDays = (Date.parse(row.last_seen || '') - Date.parse(row.first_seen || '')) / 86400000;
    if (!layer || !supported(layer, type, descriptor) || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(count) || !Number.isFinite(spanDays) || spanDays < MIN_SPAN_DAYS || !pointInGeoJSON({ lat, lng }, NYC_BOUNDARY)) continue;
    const key = `${layer}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    const current = merged.get(key) || { id: `311-${layer}-${lat.toFixed(3)}-${lng.toFixed(3)}`, layer, lat, lng, count: 0, descriptors: [], complaint_types: [], first_seen: null, last_seen: null };
    current.count += count;
    if (!current.descriptors.includes(descriptor)) current.descriptors.push(descriptor);
    if (!current.complaint_types.includes(type)) current.complaint_types.push(type);
    if (!current.first_seen || row.first_seen < current.first_seen) current.first_seen = row.first_seen || current.first_seen;
    if (!current.last_seen || row.last_seen > current.last_seen) current.last_seen = row.last_seen || current.last_seen;
    merged.set(key, current);
  }

  // The public response text can support direct statements such as “NYPD reported responding”
  // or “DHS outreach responded.” Keep those counts separate from the complaint count and never
  // turn an agency closure into an inferred physical response.
  for (const type of remoteTypes.filter(value => RESPONSE_TYPES.has(value))) {
    const safeType = type.replaceAll("'", "''");
    const params = new URLSearchParams({
      '$select': 'complaint_type,round(latitude,3) as lat,round(longitude,3) as lng,agency,resolution_description,count(*) as count',
      '$where': `created_date >= '${recent}' AND complaint_type='${safeType}' AND latitude is not null AND longitude is not null AND resolution_description is not null`,
      '$group': 'complaint_type,round(latitude,3),round(longitude,3),agency,resolution_description',
      '$limit': '50000',
    });
    const responseRows = await fetchJson(`${SOCRATA}?${params}`, { headers: appHeaders });
    for (const row of responseRows) {
      const layer = layerFor(row.complaint_type), lat = Number(row.lat), lng = Number(row.lng), count = Number(row.count);
      if (!layer || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(count)) continue;
      const item = merged.get(`${layer}|${lat.toFixed(3)}|${lng.toFixed(3)}`);
      if (!item) continue;
      const text = String(row.resolution_description || '').toLowerCase();
      const agency = String(row.agency || '').toUpperCase();
      item.responses ||= { nypd_responded: 0, nypd_observed_encampment: 0, arrests: 0, summonses: 0, dhs_outreach: 0 };
      if (agency === 'NYPD' && (text.includes('police department responded to the complaint') || text.includes('responding officers'))) item.responses.nypd_responded += count;
      if (text.includes('observed an encampment')) item.responses.nypd_observed_encampment += count;
      if (text.includes('made an arrest')) item.responses.arrests += count;
      if (text.includes('issued a summons')) item.responses.summonses += count;
      if (agency === 'DHS' && (text.includes('outreach response team') || text.includes('dhs outreach team') || text.includes('department of homeless services (dhs) visited'))) item.responses.dhs_outreach += count;
    }
  }
  enrichConditionEvidence(merged);
  for (const item of merged.values()) {
    item.descriptor = item.descriptors.join(', ');
    item.complaint_type = item.complaint_types.join(', ');
    layers[item.layer].push({ ...item,
      source: 'NYC 311', source_url: 'https://data.cityofnewyork.us/d/erm2-nwe9',
    });
  }
  if (localEncampments) layers.homelessness = localEncampments;
  return layers;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const hadExisting = fs.existsSync(OUT);
  const previous = readExisting();
  const layers = { alpr: previous.layers?.alpr || [], ...Object.fromEntries(LAYER_NAMES.map(name => [name, previous.layers?.[name] || []])) };
  const status = {};
  const now = new Date().toISOString();
  try {
    const refreshedAlpr = await refreshAlpr();
    if (layers.alpr.length >= 100 && refreshedAlpr.length < layers.alpr.length * 0.85) {
      throw new Error(`suspicious partial ALPR response (${refreshedAlpr.length} vs last-good ${layers.alpr.length})`);
    }
    layers.alpr = refreshedAlpr; status.alpr = { ok: true, count: layers.alpr.length, refreshed_at: now };
  }
  catch (error) { status.alpr = { ok: false, retained: layers.alpr.length, error: error.message, refreshed_at: previous.meta?.sources?.alpr?.refreshed_at || null }; }
  try {
    const civic = await refresh311();
    for (const name of LAYER_NAMES) layers[name] = civic[name];
    status.nyc311 = { ok: true, count: Object.values(civic).flat().length, refreshed_at: now };
  } catch (error) {
    status.nyc311 = { ok: false, retained: LAYER_NAMES.reduce((n, name) => n + layers[name].length, 0), error: error.message, refreshed_at: previous.meta?.sources?.nyc311?.refreshed_at || null };
  }
  if (!hadExisting && !status.alpr.ok && !status.nyc311.ok) {
    throw new Error('both public map sources failed and no last-good artifact exists');
  }
  const artifact = {
    meta: {
      generated_at: now, bounds: { south: 40.4774, west: -74.2591, north: 40.9176, east: -73.7004 },
      sources: status,
      layer_freshness: {
        alpr: { status: status.alpr.ok ? 'fresh' : 'retained', refreshed_at: status.alpr.refreshed_at },
        ...Object.fromEntries(LAYER_NAMES.map(name => [name, { status: status.nyc311.ok ? 'fresh' : 'retained', refreshed_at: status.nyc311.refreshed_at }])),
      },
      chronic_definition: { min_reports: MIN_REPORTS, min_span_days: MIN_SPAN_DAYS, recent_days: RECENT_DAYS, lookback_years: LOOKBACK_YEARS },
      condition_methodology: {
        version: METHOD_VERSION,
        rule: 'Encampment presence is a versioned model score updated only by distinct 311 report days, explicit public-agency observations, imperfect not-found checks, and evidence age. Community submissions are stored as unreviewed material and never enter this model or route exclusions.',
        persistence: 'Old evidence relaxes toward an uncertain site prior with a 10-day half-life. Same-day duplicate reports are heavily discounted.',
        validation: 'Parameters are checked with forward-chaining recurrence tests over public records. In the current mirror, explicit public-agency observations predict faster corroboration than report-only events, while not-found checks are only weak negative evidence. NYPD condition-corrected language is treated as temporary because about nine in ten eligible corrected coordinates were reported again within seven days.',
        limitations: 'NYC publishes address-geocoded 311 coordinates, not tent GPS fixes. Nearby coordinate variants and strongly matching same-segment address estimates are consolidated into bounded reported-location envelopes; an envelope is not a physical-instance identifier. This score is not a calibrated probability or proof of current presence. Its numeric range is heuristic, not a statistical confidence interval. Community submissions do not alter it.',
      },
      location_resolution: {
        ...locationResolutionAudit(layers.homelessness),
        rule: 'Coordinate variants within 20 m consolidate around fixed evidence-weighted anchors. Variants out to a 65 m maximum cluster diameter consolidate only when a majority of their source records identify the same street and bounding cross streets.',
        guardrails: 'Anchors never move, street-segment identity is fixed before assignment, every assisted member must remain within 65 m of every other assisted member, and all source IDs remain aliases of the canonical site.',
      },
      walk_nowcast: {
        version: WALK_NOWCAST_METHOD_VERSION,
        rollout: 'shadow',
        contract: 'Long-run site recurrence and current presence are separate targets. A quiet interval can weaken the current score without erasing a persistent multi-year site history. A public not-found response is modeled as an imperfect non-detection, never proof of absence.',
        rule: 'The beta shadow forecast publishes an inspectable recurrence evidence-strength classification beside an uncalibrated current score over public 311 and agency evidence. Its optional three-hour window says when reports were most often submitted in NYC local time over the last 90 days. Each local day contributes one total unit distributed across its reported hours; weak, diffuse, all-day, and disconnected tied patterns are omitted.',
        validation_status: 'No independently audited held-out ground-truth label set currently exists. The displayed score and range must not be described as a probability or confidence interval.',
        promotion_gate: 'Before probability language or routing use, collect independently reviewed presence and absence checks, split evaluation forward in time and by site, and publish calibration, Brier score, log loss, subgroup error, and abstention coverage against the frozen baseline.',
        routing: 'The forecast remains display-only shadow data. Route scoring and hard exclusions continue to use the independently versioned condition model.',
      },
      caveats: [
        'Mapped ALPR locations are public observations, not a complete or live inventory.',
        'Flock Safety is named only when manufacturer tags identify it.',
        'Encampment locations are bounded reported-location envelopes with 35–65 meter disclosed uncertainty. Very close coordinate variants consolidate around fixed anchors; wider variants consolidate only with matching street-segment evidence and a hard 65 meter cluster diameter. An envelope is not a live physical-instance identifier.',
        'The homelessness layer models Encampment requests only; Homeless Person Assistance reports are not presented as proof of a tent. Police and outreach counts appear only when public resolution text explicitly says the agency responded.',
      ],
    }, layers,
  };
  const temp = `${OUT}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(artifact));
  fs.renameSync(temp, OUT);
  console.log(JSON.stringify({ output: OUT, status }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { manufacturer, layerFor, supported, resolutionEvidence, conditionEvidence, parseNycWallTime, nycLocalDay,
  recordReportedLocation, reportedLocationLabel, normalizeStreetName, reportedStreetSegmentKey,
  recordReportedStreetSegment, reportedLocationDistanceMeters, consolidateReportedLocationSites,
  locationResolutionAudit, buildEncampmentSites, REPORTED_LOCATION_ENVELOPE_M,
  REPORTED_STREET_SEGMENT_ENVELOPE_M, REGISTRY, LAYER_NAMES };
