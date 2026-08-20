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
const SIDEWALK_DB = process.env.DB || path.join(process.env.SIDEWALK_DIR || '/Users/mini-home/Desktop/Monorepo/sidewalk', 'data', 'sidewalk.db');

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
  const nowDay = dayNumber(now.toISOString()),lastReportDay=days[days.length-1],silence=Math.max(0,nowDay-lastReportDay);
  const terminal = Math.max(timeline.lastCleared || 0, timeline.lastNotObserved || 0);
  const terminalDay = terminal ? dayNumber(new Date(terminal).toISOString()) : 0;
  const reportsAfterAction = terminalDay ? days.filter(day => day > terminalDay).length : 0;
  const observedNewer = timeline.lastObserved && timeline.lastObserved > terminal;
  let classification='recent_reports_unverified',label='Recently reported; not agency-confirmed',basis='Recent 311 reports exist, but the latest agency disposition does not establish that the condition remains.';
  if(observedNewer && nowDay-dayNumber(new Date(timeline.lastObserved).toISOString())<=quietWindow){classification='likely_present';label='Agency observed it recently';basis='An agency response explicitly observed the condition, and the location has not exceeded its adaptive quiet window.';}
  else if(terminal && reportsAfterAction>=2 && silence<=quietWindow){classification='likely_present';label='Reported again after agency action';basis=`Reports returned on ${reportsAfterAction} distinct days after the latest clearance or no-condition response.`;}
  else if(timeline.lastCleared && timeline.lastCleared>=Date.parse(isoDay(lastReportDay)) && nowDay-dayNumber(new Date(timeline.lastCleared).toISOString())>quietWindow){classification='likely_cleared';label='Likely cleared; no later reports';basis='The agency explicitly recorded corrective action, followed by a full location-specific quiet window with no later report day.';}
  else if(timeline.lastNotObserved && timeline.lastNotObserved>=Date.parse(isoDay(lastReportDay)) && nowDay-dayNumber(new Date(timeline.lastNotObserved).toISOString())>quietWindow){classification='likely_absent';label='Not found; no later reports';basis='The agency explicitly did not observe the condition, followed by a full location-specific quiet window with no later report day.';}
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
        const kind=resolutionEvidence(row.resolution_description),action=Date.parse(row.action_at||row.created_date||'');
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

function buildEncampmentSites(now = new Date()) {
  if (!fs.existsSync(SIDEWALK_DB)) return null;
  const db = new DatabaseSync(SIDEWALK_DB, { readOnly: true });
  const since = new Date(now.getTime() - LOOKBACK_YEARS * 365 * 86400000).toISOString().slice(0, 10);
  const query = db.prepare(`SELECT unique_key,created_date,closed_date,agency,status,resolution_description,
    resolution_action_updated_date,incident_address,borough,cast(latitude AS real) lat,cast(longitude AS real) lng
    FROM sr311 WHERE complaint_type='Encampment' AND created_date>=? AND latitude IS NOT NULL AND longitude IS NOT NULL
    ORDER BY created_date`);
  const sites = new Map();
  for (const row of query.iterate(since)) {
    const lat = Number(row.lat), lng = Number(row.lng), createdAt = Date.parse(row.created_date || '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(createdAt)) continue;
    // Four decimal places are roughly 11 m north/south and 8 m east/west in NYC. The point still
    // carries a wider uncertainty radius because 311 publishes an address geocode, not a GPS fix.
    const roundedLat = Number(lat.toFixed(4)), roundedLng = Number(lng.toFixed(4));
    const key = `${roundedLat.toFixed(4)}|${roundedLng.toFixed(4)}`;
    const item = sites.get(key) || {
      id: `311-encampment-${roundedLat.toFixed(4)}-${roundedLng.toFixed(4)}`,
      layer: 'homelessness', subject_type: 'encampment', lat, lng, count: 0,
      first_seen: null, last_seen: null, _reportDays: new Map(), _events: new Map(),
      _hasAddress: false,
      responses: { nypd_responded: 0, nypd_observed_encampment: 0, dhs_outreach: 0 },
    };
    item.count += 1;
    if (!item.first_seen || row.created_date < item.first_seen) item.first_seen = row.created_date;
    if (!item.last_seen || row.created_date > item.last_seen) {
      item.last_seen = row.created_date; item.lat = lat; item.lng = lng;
    }
    if (String(row.incident_address || '').trim()) item._hasAddress = true;
    const day = new Date(createdAt).toISOString().slice(0, 10);
    const report = item._reportDays.get(day) || { at: createdAt, count: 0 };
    report.at = Math.max(report.at, createdAt); report.count += 1; item._reportDays.set(day, report);

    const text = String(row.resolution_description || '');
    const kind = classifyResolution(text, 'Encampment');
    if (kind) {
      let actionAt = Date.parse(row.resolution_action_updated_date || row.closed_date || row.created_date || '');
      if (!Number.isFinite(actionAt) || actionAt < createdAt - 3600000) actionAt = createdAt;
      const eventDay = new Date(actionAt).toISOString().slice(0, 10);
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

  const fieldEvents = new Map();
  const ugcPath = path.join(DATA_DIR, 'ugc.db');
  if (fs.existsSync(ugcPath)) {
    const observations = new DatabaseSync(ugcPath, { readOnly: true });
    const hasTable = observations.prepare("SELECT 1 found FROM sqlite_master WHERE type='table' AND name='condition_observations'").get();
    if (hasTable) {
      const sinceObservation = new Date(now.getTime() - 90 * 86400000).toISOString();
      const rows = observations.prepare(`SELECT feature_id,state,date(observed_at) day,max(observed_at) observed_at,
        count(distinct observer_hash) observers FROM condition_observations
        WHERE observed_at>=? AND state IN ('present','absent') GROUP BY feature_id,state,date(observed_at)`).all(sinceObservation);
      for (const row of rows) {
        const list = fieldEvents.get(row.feature_id) || [];
        const verified = Number(row.observers) >= 2;
        list.push({ type: verified ? `verified_${row.state}` : `field_${row.state}`,
          at: row.observed_at, count: Number(row.observers) || 1 });
        fieldEvents.set(row.feature_id, list);
      }
    }
    observations.close();
  }

  const output = [];
  for (const item of sites.values()) {
    if (!pointInGeoJSON(item, NYC_BOUNDARY)) continue;
    const events = [
      ...[...item._reportDays.values()].map(report => ({ type: 'public_report', ...report })),
      ...item._events.values(),
      ...(fieldEvents.get(item.id) || []),
    ];
    const condition = estimatePresence(events, now);
    // Shadow only: it is exposed for app experimentation and offline calibration, but condition
    // remains the sole source for map inclusion and route avoidance until field-label validation
    // demonstrates that the nowcast improves calibrated probability estimates.
    const nowcast = estimateWalkNowcast(events, now);
    const lastAgeDays = Math.max(0, (now.getTime() - Date.parse(item.last_seen || '')) / 86400000);
    // Old, low-probability locations are neither useful map points nor route constraints. Keep
    // fresh negative checks briefly so the UI can explain why a recent report is not being avoided.
    if (lastAgeDays > 120 || (lastAgeDays > 30 && condition.routing_level === 'none')) continue;
    const distinctReportDays = item._reportDays.size;
    output.push({
      id: item.id, layer: item.layer, subject_type: item.subject_type,
      lat: item.lat, lng: item.lng, count: item.count, distinct_report_days: distinctReportDays,
      complaint_type: 'Encampment', descriptor: condition.label,
      first_seen: item.first_seen, last_seen: item.last_seen, responses: item.responses,
      condition,
      nowcast,
      field_observation_count: (fieldEvents.get(item.id) || []).reduce((sum, event) => sum + Number(event.count || 1), 0),
      location_uncertainty_m: item._hasAddress ? 35 : 45,
      location_method: 'NYC 311 reported coordinate, clustered to approximately 11 meters',
      source: 'NYC 311', source_url: 'https://data.cityofnewyork.us/d/erm2-nwe9',
    });
  }
  return output.sort((a, b) => Number(b.condition.presence_probability || 0) - Number(a.condition.presence_probability || 0)
    || Date.parse(b.last_seen || '') - Date.parse(a.last_seen || ''));
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
        rule: 'Encampment presence is a latent-state probability updated by distinct report days, explicit agency observations, imperfect not-found checks, evidence age, and verified field observations. Only high-probability sites with recent corroboration become hard route exclusions; uncertain sites are soft scoring signals and likely-absent sites are not excluded.',
        persistence: 'Old evidence relaxes toward an uncertain site prior with a 10-day half-life. Same-day duplicate reports are heavily discounted.',
        validation: 'Parameters are checked with forward-chaining recurrence tests. In the current mirror, explicit observations predict faster corroboration than report-only events, while not-found checks are only weak negative evidence. NYPD condition-corrected language is treated as temporary because about nine in ten eligible corrected coordinates were reported again within seven days.',
        limitations: 'NYC publishes address-geocoded 311 coordinates, not tent GPS fixes. The model estimates current presence near an approximately 11-meter coordinate cluster with a disclosed 35–45 meter location uncertainty; it cannot prove real-time presence without a fresh field check.',
      },
      walk_nowcast: {
        version: WALK_NOWCAST_METHOD_VERSION,
        rollout: 'shadow',
        rule: 'The shadow nowcast adds separate recency, distinct-day frequency, and location-specific cadence features to the existing latent-state estimate. It is not a routing input and does not convert a passing walker into a positive or negative observation.',
        promotion_gate: 'Promote only if time-split field-observation validation improves calibrated Brier score and does not increase the false-positive rate at the route-avoidance threshold.',
      },
      caveats: [
        'Mapped ALPR locations are public observations, not a complete or live inventory.',
        'Flock Safety is named only when manufacturer tags identify it.',
        'Encampment locations use approximately 11-meter coordinate clusters with 35–45 meter disclosed uncertainty. A 311 coordinate is an address geocode, not a live tent location.',
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

module.exports = { manufacturer, layerFor, supported, resolutionEvidence, conditionEvidence, buildEncampmentSites, REGISTRY, LAYER_NAMES };
