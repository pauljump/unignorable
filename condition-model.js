// Probabilistic current-condition estimates for noisy, opportunistic 311 observations.
//
// This is deliberately a small, inspectable state-space model. NYC 311 is not a scheduled
// survey: a missing report is not an absence observation, and a closed request is not a cleanup.
// The model therefore separates the latent condition (present/absent) from observations and
// relaxes old evidence toward an uncertain site prior instead of declaring stale reports true.

const DAY_MS = 86400000;
const METHOD_VERSION = 'encampment-presence-v2';

const PARAMETERS = Object.freeze({
  prior: 0.04,
  equilibrium: 0.06,
  relaxationHalfLifeDays: 10,
  likelihoodRatios: Object.freeze({
    public_report: 4,
    observed_encampment: 18,
    person_contact: 1.4,
    not_observed: 0.35,
    temporary_correction: 0.7,
    services_accepted: 0.65,
    cleanup_reported: 0.12,
    field_present: 8,
    field_absent: 0.25,
    verified_present: 40,
    verified_absent: 0.08,
  }),
  hardExclusionProbability: 0.72,
  softExclusionProbability: 0.3,
});

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number(value)));
const validTime = value => {
  const parsed = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value
      : Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
};
const iso = value => value == null ? null : new Date(value).toISOString();

function transitionProbability(probability, elapsedDays, parameters = PARAMETERS) {
  const days = Math.max(0, Number(elapsedDays) || 0);
  const retention = Math.pow(0.5, days / parameters.relaxationHalfLifeDays);
  return clamp(parameters.equilibrium + (clamp(probability) - parameters.equilibrium) * retention, 0.001, 0.999);
}

function applyLikelihood(probability, likelihoodRatio, strength = 1) {
  const p = clamp(probability, 0.001, 0.999);
  const ratio = Math.pow(Math.max(0.001, Number(likelihoodRatio) || 1), Math.max(0, Number(strength) || 0));
  const odds = p / (1 - p) * ratio;
  return clamp(odds / (1 + odds), 0.001, 0.999);
}

function classifyResolution(value = '', complaintType = 'Encampment') {
  const text = String(value).toLowerCase();
  const encampment = String(complaintType).toLowerCase() === 'encampment';
  if (!text) return null;
  if (encampment && text.includes('observed an encampment')) return 'observed_encampment';
  if (text.includes('observed no encampment') || text.includes('no encampment was found')
    || text.includes('could not find the condition') || text.includes('observed no evidence')
    || text.includes('did not observe') || text.includes('could not locate')) return 'not_observed';
  if (text.includes('condition has been removed') || text.includes('condition was removed')
    || text.includes('cleaned the location')) return 'cleanup_reported';
  // NYPD introduced this generic disposition broadly in July 2026. In historical backtesting,
  // the same 11 m coordinate was reported again within seven days in about nine of ten eligible cases.
  if (text.includes('condition was corrected') || text.includes('took action to fix the condition')
    || text.includes('those responsible for the condition were gone')) return 'temporary_correction';
  if (text.includes('person has accepted services') || text.includes('individual accepted assistance')) return 'services_accepted';
  if (text.includes('attempted to engage the individuals') || text.includes('offered services to the individual')
    || text.includes('person has refused services') || text.includes('individual did not accept assistance')) return 'person_contact';
  return null;
}

function evidenceSummary(events, nowMs) {
  const recent = days => events.filter(event => nowMs - event.at <= days * DAY_MS);
  const lastOf = types => events.slice().reverse().find(event => types.includes(event.type));
  const directPositive = lastOf(['verified_present', 'observed_encampment']);
  const directNegative = lastOf(['verified_absent', 'cleanup_reported', 'not_observed']);
  const latestField = lastOf(['verified_present', 'verified_absent', 'field_present', 'field_absent']);
  const latestAgency = lastOf(['observed_encampment', 'person_contact', 'not_observed', 'temporary_correction', 'services_accepted', 'cleanup_reported']);
  const reportDays14 = new Set(recent(14).filter(event => event.type === 'public_report').map(event => new Date(event.at).toISOString().slice(0, 10))).size;
  return { directPositive, directNegative, latestAgency, latestField, reportDays14 };
}

function estimatePresence(inputEvents, now = new Date(), parameters = PARAMETERS) {
  const nowMs = validTime(now) ?? Date.now();
  const events = (Array.isArray(inputEvents) ? inputEvents : [])
    .map(event => ({ ...event, at: validTime(event.at) }))
    .filter(event => event.at != null && event.at <= nowMs && parameters.likelihoodRatios[event.type])
    .sort((a, b) => a.at - b.at || String(a.type).localeCompare(String(b.type)));
  if (!events.length) {
    return {
      classification: 'unknown', label: 'Current presence unknown', presence_probability: null,
      probability_range: null, routing_level: 'none', hard_exclusion: false,
      basis: 'No usable observation timeline is available.', method_version: METHOD_VERSION,
    };
  }

  let probability = parameters.prior;
  let previousAt = events[0].at;
  for (const event of events) {
    probability = transitionProbability(probability, (event.at - previousAt) / DAY_MS, parameters);
    const count = Math.max(1, Number(event.count) || 1);
    // Multiple reports on one day are correlated. Distinct days matter much more than duplicate
    // requests, so a same-day pile-up receives only a small logarithmic increment.
    const strength = event.type === 'public_report' ? Math.min(1.35, 1 + Math.log2(count) * 0.08) : 1;
    probability = applyLikelihood(probability, parameters.likelihoodRatios[event.type], strength);
    previousAt = event.at;
  }
  probability = transitionProbability(probability, (nowMs - previousAt) / DAY_MS, parameters);

  const summary = evidenceSummary(events, nowMs);
  const directPositiveAge = summary.directPositive ? (nowMs - summary.directPositive.at) / DAY_MS : Infinity;
  const directNegativeAge = summary.directNegative ? (nowMs - summary.directNegative.at) / DAY_MS : Infinity;
  const hasFreshDirectEvidence = Math.min(directPositiveAge, directNegativeAge) <= 7;
  const uncertainty = hasFreshDirectEvidence ? 0.14 : summary.reportDays14 >= 3 ? 0.18 : 0.25;
  const low = clamp(probability - uncertainty);
  const high = clamp(probability + uncertainty);
  const hard = probability >= parameters.hardExclusionProbability
    && (directPositiveAge <= 7 || summary.reportDays14 >= 3);
  const soft = !hard && probability >= parameters.softExclusionProbability;

  let classification = 'uncertain', label = 'Current presence uncertain';
  if (probability >= parameters.hardExclusionProbability) {
    classification = 'likely_present'; label = 'Likely encampment present';
  } else if (probability <= 0.18 && directNegativeAge <= 14) {
    classification = 'likely_absent'; label = 'Likely not present now';
  } else if (probability <= 0.18 && (nowMs - previousAt) / DAY_MS > 30) {
    classification = 'stale_unknown'; label = 'Old report; current presence unknown';
  }

  const latest = events[events.length - 1];
  const lastReport = events.slice().reverse().find(event => event.type === 'public_report');
  let basis = 'The estimate combines report recurrence, evidence age, and imperfect agency detection.';
  if (summary.latestField && summary.latestField.at >= Math.max(summary.directPositive?.at || 0, summary.directNegative?.at || 0)) {
    basis = summary.latestField.type.endsWith('present')
      ? 'A nearby app user reported seeing the condition; independent checks are required before treating it as verified.'
      : 'A nearby app user reported it gone; independent checks are required before treating absence as verified.';
  } else if (summary.directPositive && summary.directPositive.at >= (summary.directNegative?.at || 0)) {
    basis = 'An agency explicitly observed an encampment; confidence falls quickly as that observation ages.';
  } else if (summary.directNegative && summary.directNegative.at >= (summary.directPositive?.at || 0)) {
    basis = summary.directNegative.type === 'cleanup_reported'
      ? 'A physical cleanup was reported, but recurrence at cleaned locations remains possible.'
      : 'A responder did not find an encampment; this is evidence of absence, not proof of removal.';
  } else if (summary.reportDays14 >= 2) {
    basis = `The location was independently reported on ${summary.reportDays14} days in the last 14 days without a newer direct observation.`;
  }

  return {
    classification, label,
    presence_probability: Math.round(probability * 100) / 100,
    probability_range: [Math.round(low * 100) / 100, Math.round(high * 100) / 100],
    routing_level: hard ? 'hard' : soft ? 'soft' : 'none', hard_exclusion: hard,
    report_days_last_14: summary.reportDays14,
    last_evidence_at: iso(latest.at), last_report_at: lastReport ? iso(lastReport.at) : null,
    last_observed_at: summary.directPositive ? iso(summary.directPositive.at) : null,
    last_not_observed_at: summary.directNegative ? iso(summary.directNegative.at) : null,
    last_checked_at: summary.latestAgency ? iso(summary.latestAgency.at) : null,
    last_field_observed_at: summary.latestField ? iso(summary.latestField.at) : null,
    basis, method_version: METHOD_VERSION,
  };
}

function routingLevel(feature) {
  if (!feature) return 'none';
  if (feature.layer === 'alpr') return 'hard';
  const condition = feature.condition || {};
  if (condition.routing_level) return condition.routing_level;
  if (condition.hard_exclusion === true || condition.classification === 'likely_present') return 'hard';
  if (['recent_reports_unverified', 'dormant_unknown', 'uncertain'].includes(condition.classification)) return 'soft';
  return 'none';
}

module.exports = {
  DAY_MS, METHOD_VERSION, PARAMETERS, transitionProbability, applyLikelihood,
  classifyResolution, estimatePresence, routingLevel,
};
