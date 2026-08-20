// Shadow-mode walk nowcast for noisy civic observations.
//
// This does not treat a 311 ticket, a closed ticket, or a passer-by as proof that a
// condition is present. It combines the existing event-state estimate with transparent
// recurrence, recency, and independent-evidence features. The result is kept in shadow
// mode. It is an uncalibrated score, not a measured probability, until independently audited
// held-out labels and an evaluation protocol exist.

const { estimatePresence } = require('./condition-model');

const DAY_MS = 86_400_000;
const METHOD_VERSION = 'walk-nowcast-v3-shadow';
const CONTRACT_VERSION = 'condition-forecast-v1';
const LOCAL_TIME_ZONE = 'America/New_York';
const TIME_WINDOW_HOURS = 3;
const TIME_WINDOW_LOOKBACK_DAYS = 90;
const MIN_TIME_WINDOW_DAYS = 8;

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number(value) || 0));
const logit = probability => {
  const p = clamp(probability, 0.001, 0.999);
  return Math.log(p / (1 - p));
};
const logistic = value => 1 / (1 + Math.exp(-value));
const validTime = value => {
  const time = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value
      : Date.parse(value || '');
  return Number.isFinite(time) ? time : null;
};
const round = (value, places = 2) => Number(Number(value).toFixed(places));
const localPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: LOCAL_TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
});

function localParts(at) {
  const parts = Object.fromEntries(localPartsFormatter.formatToParts(new Date(at))
    .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

function median(values, fallback = null) {
  if (!values.length) return fallback;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function normalizedEvents(inputEvents, nowMs) {
  return (Array.isArray(inputEvents) ? inputEvents : [])
    .map(event => ({
      ...event,
      at: validTime(event.at),
      count: Math.max(1, Number(event.count) || 1),
      local_day: /^\d{4}-\d{2}-\d{2}$/.test(String(event.local_day || '')) ? event.local_day : null,
      local_hours: [...new Set((Array.isArray(event.local_hours) ? event.local_hours : [])
        .map(Number).filter(hour => Number.isInteger(hour) && hour >= 0 && hour <= 23))],
    }))
    .filter(event => event.at != null && event.at <= nowMs)
    .sort((left, right) => left.at - right.at || String(left.type).localeCompare(String(right.type)));
}

function publicReportDays(events) {
  const seen = new Map();
  for (const event of events) {
    if (event.type !== 'public_report') continue;
    const key = event.local_day || localParts(event.at).day;
    const current = seen.get(key) || { at: event.at, count: 0 };
    current.at = Math.max(current.at, event.at);
    current.count += event.count;
    seen.set(key, current);
  }
  return [...seen.values()].sort((left, right) => left.at - right.at);
}

function hourLabel(hour) {
  const normalized = ((Number(hour) % 24) + 24) % 24;
  if (normalized === 0) return '12 AM';
  if (normalized === 12) return '12 PM';
  return `${normalized % 12} ${normalized < 12 ? 'AM' : 'PM'}`;
}

function timeRangeLabel(startHour, endHour) {
  const start = hourLabel(startHour), end = hourLabel(endHour);
  const startPeriod = start.slice(-2), endPeriod = end.slice(-2);
  return startPeriod === endPeriod ? `${start.slice(0, -3)}\u2013${end}` : `${start}\u2013${end}`;
}

// This describes when reports were historically submitted, not when a condition was present.
// Every local day contributes exactly one total unit, distributed evenly across the distinct
// hours reported that day. A diffuse or all-day reporting day therefore cannot vote fully for
// every candidate window, and duplicate bursts cannot manufacture a precise time pattern.
function localTimeWindow(events, nowMs) {
  const byDay = new Map();
  for (const event of events) {
    if (event.type !== 'public_report' || nowMs - event.at > TIME_WINDOW_LOOKBACK_DAYS * DAY_MS) continue;
    const fallback = localParts(event.at);
    const day = event.local_day || fallback.day;
    const hours = Array.isArray(event.local_hours) && event.local_hours.length ? event.local_hours : [fallback.hour];
    const dayHours = byDay.get(day) || new Set();
    for (const hour of hours) dayHours.add(hour);
    byDay.set(day, dayHours);
  }
  const reportDays = byDay.size;
  if (reportDays < MIN_TIME_WINDOW_DAYS) return null;

  const hourWeights = Array(24).fill(0);
  for (const hours of byDay.values()) {
    const weight = 1 / hours.size;
    for (const hour of hours) hourWeights[hour] += weight;
  }
  const scores = Array(24).fill(0).map((_, start) => Array.from({ length: TIME_WINDOW_HOURS },
    (unused, offset) => hourWeights[(start + offset) % 24]).reduce((sum, value) => sum + value, 0));
  const bestScore = Math.max(...scores);
  const bestStarts = scores.map((score, start) => ({ score, start }))
    .filter(candidate => Math.abs(candidate.score - bestScore) < 1e-9).map(candidate => candidate.start);
  const sharedHours = bestStarts.reduce((shared, start) => {
    const hours = new Set(Array.from({ length: TIME_WINDOW_HOURS }, (_, offset) => (start + offset) % 24));
    return shared == null ? hours : new Set([...shared].filter(hour => hours.has(hour)));
  }, null);
  // Equal peaks in disconnected parts of the day are not one useful window.
  if (!sharedHours?.size) return null;
  let bestStart = bestStarts[0], bestCenterWeight = -1;
  for (const start of bestStarts) {
    const centerWeight = hourWeights[(start + Math.floor(TIME_WINDOW_HOURS / 2)) % 24];
    if (centerWeight > bestCenterWeight) { bestStart = start; bestCenterWeight = centerWeight; }
  }
  const concentration = bestScore / reportDays;
  // Primary clients only receive moderate or strong patterns; weak clocks are omitted.
  if (concentration < 0.5) return null;
  const strength = reportDays >= 15 && concentration >= 0.65 ? 'strong'
    : 'moderate';
  const endHour = (bestStart + TIME_WINDOW_HOURS) % 24;
  return {
    start_hour: bestStart,
    end_hour: endHour,
    timezone: LOCAL_TIME_ZONE,
    label: timeRangeLabel(bestStart, endHour),
    report_days: reportDays,
    days_in_window: Math.round(bestScore),
    effective_days_in_window: round(bestScore),
    sample_size: reportDays,
    concentration: round(concentration),
    strength,
    basis: `Historical NYC-local report timing over the last ${TIME_WINDOW_LOOKBACK_DAYS} days; each local day contributes one total unit distributed across its reported hours; not proof of physical presence.`,
  };
}

function countWithin(days, nowMs, windowDays) {
  return days.filter(day => nowMs - day.at <= windowDays * DAY_MS).length;
}

function latestOf(events, types) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (types.includes(events[index].type)) return events[index];
  }
  return null;
}

function evidenceFeatures(events, nowMs) {
  const days = publicReportDays(events);
  const reportGaps = [];
  for (let index = 1; index < days.length; index += 1) reportGaps.push((days[index].at - days[index - 1].at) / DAY_MS);

  const latestReport = days.at(-1) || null;
  const latestPositive = latestOf(events, ['observed_encampment']);
  const latestNegative = latestOf(events, ['cleanup_reported', 'not_observed']);
  const latestDirect = latestOf(events, ['observed_encampment', 'not_observed', 'cleanup_reported']);
  const latestAt = Math.max(latestReport?.at || 0, latestDirect?.at || 0) || null;
  const reportAgeDays = latestReport ? Math.max(0, (nowMs - latestReport.at) / DAY_MS) : null;
  const siteCadenceDays = median(reportGaps, null);
  const reports7 = countWithin(days, nowMs, 7);
  const reports14 = countWithin(days, nowMs, 14);
  const reports30 = countWithin(days, nowMs, 30);
  const reports90 = countWithin(days, nowMs, 90);

  const frequency = clamp((Math.log1p(reports7) * 0.34) + (Math.log1p(reports30) * 0.20) + (Math.log1p(reports90) * 0.08));
  const recency = reportAgeDays == null ? 0 : Math.exp(-reportAgeDays / 7);
  const cadence = siteCadenceDays == null ? 0 : clamp(Math.exp(-Math.max(0, reportAgeDays || 0) / Math.max(7, siteCadenceDays * 2.5)));
  const positiveAgeDays = latestPositive ? Math.max(0, (nowMs - latestPositive.at) / DAY_MS) : null;
  const negativeAgeDays = latestNegative ? Math.max(0, (nowMs - latestNegative.at) / DAY_MS) : null;
  const positiveDirectness = latestPositive
    ? 0.8 * Math.exp(-positiveAgeDays / 7)
    : 0;
  const negativeDirectness = latestNegative
    ? (latestNegative.type === 'cleanup_reported' ? 0.65 : 0.55) * Math.exp(-negativeAgeDays / 5)
    : 0;

  return {
    report_days_7: reports7, report_days_14: reports14, report_days_30: reports30, report_days_90: reports90,
    report_age_days: reportAgeDays == null ? null : round(reportAgeDays, 1),
    report_cadence_days: siteCadenceDays == null ? null : round(siteCadenceDays, 1),
    recency_signal: round(recency), frequency_signal: round(frequency), cadence_signal: round(cadence),
    positive_evidence_signal: round(positiveDirectness), negative_evidence_signal: round(negativeDirectness),
    last_report_at: latestReport ? new Date(latestReport.at).toISOString() : null,
    last_direct_check_at: latestDirect ? new Date(latestDirect.at).toISOString() : null,
  };
}

function confidenceTier(features) {
  if (features.positive_evidence_signal >= 0.75 || features.negative_evidence_signal >= 0.75) return 'high';
  if (features.positive_evidence_signal >= 0.35 || features.negative_evidence_signal >= 0.35 || features.report_days_7 >= 2 || features.report_days_14 >= 3) return 'medium';
  return 'low';
}

function labelFor(probability, confidence) {
  if (probability >= 0.74 && confidence !== 'low') return 'Condition likely near this location';
  if (probability >= 0.45) return 'Condition may be near this location';
  if (probability <= 0.18 && confidence !== 'low') return 'Condition less likely near this location';
  return 'Insufficient current evidence';
}

function estimateWalkNowcast(inputEvents, now = new Date(), options = {}) {
  const nowMs = validTime(now) ?? Date.now();
  const events = normalizedEvents(inputEvents, nowMs);
  const legacy = estimatePresence(events, new Date(nowMs));
  const timeWindow = localTimeWindow(events, nowMs);
  const locationRadius = Number(options.locationUncertaintyM);
  const spatialUncertainty = Number.isFinite(locationRadius) && locationRadius > 0 ? {
    radius_m: Math.round(locationRadius),
    label: `Within about ${Math.round(locationRadius)} m`,
    basis: String(options.locationMethod || 'Reported coordinates are approximate and do not identify an exact physical footprint.'),
  } : null;
  if (!events.length || legacy.presence_probability == null) {
    return { contract_version: CONTRACT_VERSION, method_version: METHOD_VERSION, rollout: 'shadow', status: 'beta',
      as_of: new Date(nowMs).toISOString(), label: 'Insufficient current evidence', current_probability: null, live_probability: null,
      score_semantics: 'uncalibrated_shadow_score', uncalibrated_score: null,
      probability_range: null, score_range: null, range_semantics: 'heuristic_score_range_not_confidence_interval',
      confidence: 'low', confidence_semantics: 'evidence_strength_not_statistical_confidence',
      local_time_window: timeWindow, spatial_uncertainty: spatialUncertainty,
      features: evidenceFeatures(events, nowMs), basis: 'No usable observation timeline is available.' };
  }

  const features = evidenceFeatures(events, nowMs);
  const adjustment = 0.42 * (features.recency_signal - 0.5) + 0.36 * (features.frequency_signal - 0.28)
    + 0.24 * (features.cadence_signal - 0.35) + 0.82 * features.positive_evidence_signal - 0.66 * features.negative_evidence_signal;
  const score = clamp(logistic(logit(legacy.presence_probability) + adjustment), 0.01, 0.99);
  const confidence = confidenceTier(features);
  const independentDays = Math.min(1, Math.log1p(features.report_days_30) / Math.log(8));
  const evidenceQuality = clamp(Math.max(features.positive_evidence_signal, features.negative_evidence_signal, independentDays * 0.55));
  const radius = clamp(0.34 - evidenceQuality * 0.19, 0.12, 0.34);

  return {
    contract_version: CONTRACT_VERSION, method_version: METHOD_VERSION, rollout: 'shadow', status: 'beta',
    as_of: new Date(nowMs).toISOString(), label: labelFor(score, confidence),
    score_semantics: 'uncalibrated_shadow_score', uncalibrated_score: round(score),
    current_probability: round(score), live_probability: round(score),
    range_semantics: 'heuristic_score_range_not_confidence_interval',
    score_range: [round(clamp(score - radius)), round(clamp(score + radius))],
    probability_range: [round(clamp(score - radius)), round(clamp(score + radius))], confidence,
    confidence_semantics: 'evidence_strength_not_statistical_confidence',
    local_time_window: timeWindow, spatial_uncertainty: spatialUncertainty, features,
    basis: 'Beta shadow score combines time-decayed recurrence, report cadence, and public agency observations. It is uncalibrated, is not a field-confirmed live status or probability, and is not used for routing.',
  };
}

module.exports = { CONTRACT_VERSION, METHOD_VERSION, LOCAL_TIME_ZONE, evidenceFeatures, localTimeWindow, estimateWalkNowcast };
