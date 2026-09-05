// Pure geometry and export helpers for the NYC awareness map.
// Kept dependency-free so the same behavior is deterministic in tests and at runtime.

const RAD = Math.PI / 180;
const { routingLevel } = require('./condition-model');

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0]), yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]), yj = Number(ring[j][1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const crosses = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng, lat, polygon) {
  if (!polygon.length || !pointInRing(lng, lat, polygon[0])) return false;
  return !polygon.slice(1).some(hole => pointInRing(lng, lat, hole));
}

function pointInGeometry(point, geometry) {
  const lat = Number(point && point.lat), lng = Number(point && point.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygon(lng, lat, geometry.coordinates || []);
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).some(polygon => pointInPolygon(lng, lat, polygon));
  return false;
}

function pointInGeoJSON(point, geojson) {
  if (!geojson) return false;
  if (geojson.type === 'FeatureCollection') return (geojson.features || []).some(feature => pointInGeometry(point, feature.geometry));
  if (geojson.type === 'Feature') return pointInGeometry(point, geojson.geometry);
  return pointInGeometry(point, geojson);
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const x = (bLng - aLng) * RAD * Math.cos((aLat + bLat) * RAD / 2);
  const y = (bLat - aLat) * RAD;
  return Math.sqrt(x * x + y * y) * 6371000;
}

function pointSegmentDistanceMeters(point, a, b) {
  const midLat = (a[1] + b[1] + point.lat) / 3;
  const xScale = 111320 * Math.cos(midLat * RAD);
  const yScale = 110540;
  const px = (point.lng - a[0]) * xScale;
  const py = (point.lat - a[1]) * yScale;
  const bx = (b[0] - a[0]) * xScale;
  const by = (b[1] - a[1]) * yScale;
  const denom = bx * bx + by * by;
  const t = denom ? Math.max(0, Math.min(1, (px * bx + py * by) / denom)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

function routeIntersectsPoint(coordinates, point, radiusMeters) {
  for (let i = 1; i < coordinates.length; i++) {
    if (pointSegmentDistanceMeters(point, coordinates[i - 1], coordinates[i]) <= radiusMeters) return true;
  }
  return false;
}

const LAYER_RADII = Object.freeze({
  alpr: 45,
  // Encampment sites are now grouped at ~11 m coordinates instead of one-block cells. The
  // buffer still acknowledges that 311 coordinates are address geocodes, not tent GPS fixes.
  homelessness: 55,
  drugs: 110,
  dumping: 110,
  sidewalk: 110,
  street: 110,
  signals: 110,
});
const LAYER_WEIGHTS = Object.freeze({
  alpr: 1,
  homelessness: 1.1,
  drugs: 1,
  dumping: 0.7,
  sidewalk: 0.85,
  street: 0.8,
  signals: 0.9,
});

// A 311 cluster is not a binary fact. Routing should distinguish an agency-observed,
// recently recurring condition from an old report that merely has not been disproved.
// These values intentionally stay conservative: they affect recommendation order, while
// selected locations are still sent to the router as hard exclusions wherever possible.
const CONDITION_CONFIDENCE = Object.freeze({
  likely_present: 1,
  recent_reports_unverified: 0.62,
  dormant_unknown: 0.36,
  likely_absent: 0.16,
  likely_cleared: 0.08,
  unknown: 0.3,
});

function featureRadius(feature) {
  const base = Number(LAYER_RADII[feature?.layer] || 110);
  const uncertainty = Number(feature?.location_uncertainty_m);
  if (!Number.isFinite(uncertainty)) return base;
  return Math.max(base, Math.min(145, uncertainty));
}

function featureRisk(feature, now = Date.now()) {
  if (!feature) return 0;
  const layer = feature.layer;
  const base = Number(LAYER_WEIGHTS[layer] || 1);
  if (layer === 'alpr') return base;
  const routing = routingLevel(feature);
  if (routing === 'none') return 0;
  const classification = feature.condition && feature.condition.classification || 'unknown';
  const modeled = Number(feature.condition?.presence_probability);
  const confidence = Number.isFinite(modeled)
    ? modeled
    : Number(CONDITION_CONFIDENCE[classification] || CONDITION_CONFIDENCE.unknown);
  const lastSeen = Date.parse(feature.last_seen || feature.condition?.last_report_at || '');
  const ageDays = Number.isFinite(lastSeen) ? Math.max(0, (now - lastSeen) / 86400000) : 180;
  const freshness = Math.max(0.35, Math.min(1, 1 - ageDays / 365));
  const count = Math.max(1, Number(feature.count) || 1);
  const recurrence = 0.75 + Math.min(0.45, Math.log1p(count) / Math.log1p(100) * 0.45);
  return Math.round(base * confidence * freshness * recurrence * 100) / 100;
}

function routeHitFeatures(route, layers, selected = Object.keys(LAYER_RADII)) {
  const coordinates = route.geometry && route.geometry.coordinates || [];
  const lngs = coordinates.map(point => point[0]).filter(Number.isFinite);
  const lats = coordinates.map(point => point[1]).filter(Number.isFinite);
  const bounds = lngs.length && lats.length ? {
    west: Math.min(...lngs) - 0.002, east: Math.max(...lngs) + 0.002,
    south: Math.min(...lats) - 0.002, north: Math.max(...lats) + 0.002,
  } : null;
  const hits = {};
  for (const layer of Object.keys(LAYER_RADII)) {
    if (!selected.includes(layer)) { hits[layer] = []; continue; }
    const features = Array.isArray(layers[layer]) ? layers[layer] : [];
    hits[layer] = features.filter(feature => routingLevel(feature) !== 'none' && (!bounds || (
      feature.lng >= bounds.west && feature.lng <= bounds.east
      && feature.lat >= bounds.south && feature.lat <= bounds.north
    )) && routeIntersectsPoint(coordinates, feature, featureRadius(feature)));
  }
  return hits;
}

function scoreRoute(route, layers, selected) {
  const coordinates = route.geometry && route.geometry.coordinates || [];
  const hits = routeHitFeatures(route, layers);
  const metrics = {};
  let awarenessScore = 0;
  let selectedIntersections = 0;
  for (const layer of Object.keys(LAYER_RADII)) {
    metrics[layer] = hits[layer].length;
    if (selected.includes(layer)) {
      selectedIntersections += hits[layer].filter(feature => routingLevel(feature) === 'hard').length;
      awarenessScore += hits[layer].reduce((sum, feature) => sum + featureRisk(feature), 0);
    }
  }
  return { ...route, metrics, selectedIntersections, awarenessScore: Math.round(awarenessScore * 100) / 100, riskScore: Math.round(awarenessScore * 100) / 100 };
}

function plausibleRoutes(routes, profile = 'driving') {
  if (!routes.length) return [];
  const durations = routes.map(route => Number(route.duration)).filter(Number.isFinite);
  const distances = routes.map(route => Number(route.distance)).filter(Number.isFinite);
  const fastest = Math.min(...durations);
  const shortest = Math.min(...distances);
  if (!Number.isFinite(fastest) || !Number.isFinite(shortest)) return routes.slice();
  // A person should never be sent on a visibly absurd walk just to improve the map score.
  // Walking candidates are capped at a 30% time / 35% distance premium over the direct set.
  const durationRatio = profile === 'walking' ? 1.3 : 1.75;
  const distanceRatio = profile === 'walking' ? 1.35 : 1.9;
  const plausible = routes.filter(route => Number(route.duration) <= fastest * durationRatio
    && Number(route.distance) <= shortest * distanceRatio);
  return plausible.length ? plausible : routes.filter(route => Number(route.duration) === fastest).slice(0, 1);
}

function chooseRecommended(routes, profile = 'driving') {
  if (!routes.length) return -1;
  const allowed = new Set(plausibleRoutes(routes, profile));
  const available = routes.map((route, index) => ({ route, index })).filter(item => allowed.has(item.route));
  if (!available.length) return -1;
  const hasCrossingMetric = available.some(item => Number.isFinite(Number(item.route.selectedIntersections)));
  const minCrossings = hasCrossingMetric ? Math.min(...available.map(item => Number(item.route.selectedIntersections) || 0)) : null;
  const crossingPreferred = hasCrossingMetric
    ? available.filter(item => (Number(item.route.selectedIntersections) || 0) === minCrossings)
    : available;
  const hasRisk = available.some(item => Number.isFinite(Number(item.route.riskScore ?? item.route.awarenessScore))
    && Number(item.route.riskScore ?? item.route.awarenessScore) > 0);
  const fastest = Math.min(...crossingPreferred.map(item => Number(item.route.duration)).filter(Number.isFinite));
  const shortest = Math.min(...crossingPreferred.map(item => Number(item.route.distance)).filter(Number.isFinite));
  const lowestRisk = Math.min(...crossingPreferred.map(item => Number(item.route.riskScore ?? item.route.awarenessScore) || 0));
  if (!hasRisk) {
    const fastestItem = crossingPreferred.slice().sort((a, b) => Number(a.route.duration) - Number(b.route.duration))[0];
    return fastestItem.index;
  }
  // Prefer the safest corridor, but do not let a barely-better score create an unnecessary
  // detour. The plausibility gate above prevents truly absurd walks/drives from entering here.
  const riskSlack = Math.max(0.15, lowestRisk * 0.2);
  const ranked = crossingPreferred
    .sort((a, b) => {
      const ar = Number(a.route.riskScore ?? a.route.awarenessScore) || 0;
      const br = Number(b.route.riskScore ?? b.route.awarenessScore) || 0;
      if (hasRisk && Math.abs(ar - br) > riskSlack) return ar - br;
      const ad = Number(a.route.duration) / fastest, bd = Number(b.route.duration) / fastest;
      const ax = Number(a.route.distance) / shortest, bx = Number(b.route.distance) / shortest;
      return (ad + ax * 0.35) - (bd + bx * 0.35);
    });
  return ranked[0].index;
}

function shapingWaypoints(coordinates, max = 9) {
  if (!Array.isArray(coordinates) || coordinates.length < 4) return [];
  const out = [];
  for (let i = 1; i <= max; i++) {
    const index = Math.round(i * (coordinates.length - 1) / (max + 1));
    const coordinate = coordinates[index];
    if (coordinate) out.push({ lat: coordinate[1], lng: coordinate[0] });
  }
  return out;
}

function exportUrls(origin, destination, coordinates, profile = 'driving', via = null) {
  const coord = p => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`;
  if (profile === 'walking') {
    // A map URL requests a new route; it cannot import our polyline or exclusions.
    // Use the older Apple endpoint for iOS 17+ compatibility. Explicit stops get
    // separate legs so unsupported multi-stop walking cannot silently skip them.
    const links = (from, to) => {
      const google = new URL('https://www.google.com/maps/dir/');
      google.searchParams.set('api', '1');
      google.searchParams.set('origin', coord(from));
      google.searchParams.set('destination', coord(to));
      google.searchParams.set('travelmode', 'walking');
      const apple = new URL('https://maps.apple.com/');
      apple.searchParams.set('saddr', coord(from));
      apple.searchParams.set('daddr', coord(to));
      apple.searchParams.set('dirflg', 'w');
      return { apple: apple.toString(), google: google.toString() };
    };
    const legs = via
      ? [{ id: 'to-stop', name: `To stop: ${via.name || 'planned stop'}`, ...links(origin, via) },
         { id: 'to-destination', name: 'From stop to destination', ...links(via, destination) }]
      : [{ id: 'to-destination', name: 'To destination', ...links(origin, destination) }];
    return { ...links(origin, destination), shapingWaypoints: 0, externalWaypoints: 0,
      includesVia: false, handoff: 'separate_walking_legs', legs };
  }
  // Google Maps URLs reliably accept at most three waypoints in mobile browsers. Keep the
  // intentional stop first, then use the remaining slots to suggest the generated corridor.
  // External map apps remain free to recalculate; the in-app polyline/GPX is the exact route.
  const shaped = shapingWaypoints(coordinates, via ? 2 : 3);
  const externalWaypoints = [...(via ? [via] : []), ...shaped]
    .filter((point, index, list) => list.findIndex(other => coord(other) === coord(point)) === index)
    .slice(0, 3);
  const waypoints = externalWaypoints.map(coord).join('|');
  const google = new URL('https://www.google.com/maps/dir/');
  google.searchParams.set('api', '1');
  google.searchParams.set('origin', coord(origin));
  google.searchParams.set('destination', coord(destination));
  google.searchParams.set('travelmode', profile === 'walking' ? 'walking' : 'driving');
  google.searchParams.set('avoid', 'ferries');
  google.searchParams.set('dir_action', 'navigate');
  if (waypoints) google.searchParams.set('waypoints', waypoints);
  const apple = new URL('https://maps.apple.com/directions');
  apple.searchParams.set('source', coord(origin));
  apple.searchParams.set('destination', coord(destination));
  apple.searchParams.set('mode', profile === 'walking' ? 'walking' : 'driving');
  apple.searchParams.set('avoid', 'ferries');
  for (const waypoint of externalWaypoints) apple.searchParams.append('waypoint', coord(waypoint));
  return {
    google: google.toString(), apple: apple.toString(),
    shapingWaypoints: shaped.length, externalWaypoints: externalWaypoints.length,
    includesVia: Boolean(via),
  };
}

// Keep every actual turn, crossing, stop and arrival. Only identical straight
// continuations may merge. Geometry alone is not a substitute for walking instructions.
function simplifyWalkingSteps(steps) {
  if (!Array.isArray(steps)) return [];
  const output = [];
  for (const step of steps) {
    if (!step || typeof step.instruction !== 'string' || !step.instruction.trim()) continue;
    const normalized = { ...step, instruction: step.instruction.trim(),
      distance: Math.max(0, Number(step.distance) || 0), duration: Math.max(0, Number(step.duration) || 0) };
    const previous = output[output.length - 1];
    const straight = item => item && item.type === 'continue' && (!item.modifier || item.modifier === 'straight')
      && !/\b(turn|cross|stairs?|steps?|elevator|bridge|tunnel|arriv|stop)\b/i.test(item.instruction);
    if (straight(previous) && straight(normalized) && previous.instruction === normalized.instruction) {
      previous.distance += normalized.distance; previous.duration += normalized.duration;
    } else output.push(normalized);
  }
  return output;
}

module.exports = { pointInGeoJSON, distanceMeters, pointSegmentDistanceMeters, routeIntersectsPoint, routeHitFeatures, featureRadius, featureRisk, scoreRoute, plausibleRoutes, chooseRecommended, shapingWaypoints, exportUrls, simplifyWalkingSteps, LAYER_RADII, LAYER_WEIGHTS, CONDITION_CONFIDENCE };
