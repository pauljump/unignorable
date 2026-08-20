// Shadow-mode walk nowcast for noisy civic observations.
//
// This does not treat a 311 ticket, a closed ticket, or a passer-by as proof that a
// condition is present. It combines the existing event-state estimate with transparent
// recurrence, recency, and independent-evidence features. The result is kept in shadow
// mode until rolling forward validation against field observations justifies promotion.

const { estimatePresence } = require('./condition-model');

const DAY_MS = 86_400_000;
const METHOD_VERSION = 'walk-nowcast-v1-shadow';

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

function median(values, fallback = null) {
  if (!values.length) return fallback;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function normalizedEvents(inputEvents, nowMs) {
  return (Array.isArray(inputEvents) ? inputEvents : [])
    .map(event => ({ ...event, at: validTime(event.at), count: Math.max(1, Number(event.count) || 1) }))
    .filter(event => event.at != null && event.at <= nowMs)
    .sort((left, right) => left.at - right.at || String(left.type).localeCompare(String(right.type)));
}

function publicReportDays(events) {
  const seen = new Map();
  for (const event of events) {
    if (event.type !== 'public_report') continue;
    const key = new Date(event.at).toISOString().slice(0, 10);
    const current = seen.get(key) || { at: event.at, count: 0 };
    current.at = Math.max(current.at, event.at);
    current.count += event.count;
    seen.set(key, current);
  }
  return [...seen.values()].sort((left, right) => left.at - right.at);
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
  const latestPositive = latestOf(events, ['verified_present', 'field_present', 'observed_encampment']);
  const latestNegative = latestOf(events, ['verified_absent', 'field_absent', 'cleanup_reported', 'not_observed']);
  const latestDirect = latestOf(events, ['verified_present', 'verified_absent', 'observed_encampment', 'not_observed', 'cleanup_reported']);
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
    ? (latestPositive.type === 'verified_present' ? 1 : latestPositive.type === 'observed_encampment' ? 0.8 : 0.45) * Math.exp(-positiveAgeDays / 7)
    : 0;
  const negativeDirectness = latestNegative
    ? (latestNegative.type === 'verified_absent' ? 1 : latestNegative.type === 'cleanup_reported' ? 0.65 : latestNegative.type === 'not_observed' ? 0.55 : 0.35) * Math.exp(-negativeAgeDays / 5)
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
  if (probability >= 0.74 && confidence !== 'low') return 'Likely live now';
  if (probability >= 0.45) return 'Recurring; live status uncertain';
  if (probability <= 0.18 && confidence !== 'low') return 'Likely not live now';
  return 'Insufficient current evidence';
}

function estimateWalkNowcast(inputEvents, now = new Date()) {
  const nowMs = validTime(now) ?? Date.now();
  const events = normalizedEvents(inputEvents, nowMs);
  const legacy = estimatePresence(events, new Date(nowMs));
  if (!events.length || legacy.presence_probability == null) {
    return { method_version: METHOD_VERSION, rollout: 'shadow', label: 'Insufficient current evidence', live_probability: null,
      probability_range: null, confidence: 'low', features: evidenceFeatures(events, nowMs), basis: 'No usable observation timeline is available.' };
  }

  const features = evidenceFeatures(events, nowMs);
  const adjustment = 0.42 * (features.recency_signal - 0.5) + 0.36 * (features.frequency_signal - 0.28)
    + 0.24 * (features.cadence_signal - 0.35) + 0.82 * features.positive_evidence_signal - 0.66 * features.negative_evidence_signal;
  const probability = clamp(logistic(logit(legacy.presence_probability) + adjustment), 0.01, 0.99);
  const confidence = confidenceTier(features);
  const independentDays = Math.min(1, Math.log1p(features.report_days_30) / Math.log(8));
  const evidenceQuality = clamp(Math.max(features.positive_evidence_signal, features.negative_evidence_signal, independentDays * 0.55));
  const radius = clamp(0.34 - evidenceQuality * 0.19, 0.12, 0.34);

  return {
    method_version: METHOD_VERSION, rollout: 'shadow', label: labelFor(probability, confidence), live_probability: round(probability),
    probability_range: [round(clamp(probability - radius)), round(clamp(probability + radius))], confidence, features,
    basis: 'Shadow estimate combines time-decayed recurrence, report cadence, and direct observations. It is not used for routing until calibrated against field observations.',
  };
}

module.exports = { METHOD_VERSION, evidenceFeatures, estimateWalkNowcast };
