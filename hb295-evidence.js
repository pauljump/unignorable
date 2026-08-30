// Conservative evidence checklist for Georgia O.C.G.A. § 36-60-34 (HB 295).
// This module organizes records for attorney review. It deliberately does not decide whether
// Atlanta maintained a public nuisance, adopted a policy/pattern/practice, or caused damages.

const COVERED_CATEGORIES = Object.freeze([
  'illegal public camping',
  'loitering',
  'obstructing public thoroughfares',
  'panhandling',
  'possession or use of controlled substances',
  'shoplifting',
  'public intoxication or public urination while trespassing on private property',
]);

const CATEGORY_ALIASES = new Map([
  ['camping', 'illegal public camping'],
  ['encampment', 'illegal public camping'],
  ['loitering', 'loitering'],
  ['obstruction', 'obstructing public thoroughfares'],
  ['blocked thoroughfare', 'obstructing public thoroughfares'],
  ['panhandling', 'panhandling'],
  ['drug activity', 'possession or use of controlled substances'],
  ['controlled substance', 'possession or use of controlled substances'],
  ['shoplifting', 'shoplifting'],
  ['public intoxication', 'public intoxication or public urination while trespassing on private property'],
  ['public urination', 'public intoxication or public urination while trespassing on private property'],
]);

function normalizeCategory(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (COVERED_CATEGORIES.includes(text)) return text;
  for (const [alias, category] of CATEGORY_ALIASES) {
    if (text.includes(alias)) return category;
  }
  return null;
}

function validDate(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function checklistStatus(value) {
  return value ? 'documented' : 'missing';
}

function buildHB295Checklist(input = {}) {
  const records = Array.isArray(input.records) ? input.records : [];
  const categorized = records.map(record => ({
    id: record && record.id != null ? String(record.id) : null,
    category: normalizeCategory(record && (record.category || record.type || record.description)),
    opened_at: validDate(record && (record.opened_at || record.created_at || record.opened_date)),
    closed_at: validDate(record && (record.closed_at || record.closed_date)),
    status: record && record.status ? String(record.status) : null,
    source_url: record && record.source_url ? String(record.source_url) : null,
  }));
  const categories = [...new Set(categorized.map(record => record.category).filter(Boolean))];
  const eventYears = [...new Set(categorized.map(record => record.opened_at && record.opened_at.slice(0, 4)).filter(Boolean))];
  const claimYear = input.claim_year == null ? null : String(input.claim_year);
  const ownerDocumented = ['fee_simple', 'leasehold'].includes(String(input.owner_type || '').toLowerCase());
  const parcelDocumented = Boolean(String(input.parcel_id || input.property_address || '').trim());
  const governmentDocumented = String(input.local_government || '').toLowerCase() === 'city_of_atlanta';
  const expenseAmount = Number(input.documented_expenses);
  const expensesDocumented = Number.isFinite(expenseAmount) && expenseAmount > 0;
  const valueEvidenceDocumented = Boolean(input.fair_market_value_evidence);
  const damageDocumented = expensesDocumented || valueEvidenceDocumented;
  const taxYearMatches = Boolean(claimYear && eventYears.includes(claimYear));
  const gaps = [];
  if (!ownerDocumented) gaps.push('Document fee-simple ownership or a leasehold interest.');
  if (!parcelDocumented) gaps.push('Identify the parcel or property address.');
  if (!governmentDocumented) gaps.push('Confirm that the relevant local government is the City of Atlanta.');
  if (!categories.length) gaps.push('Link at least one record to a covered HB 295 category.');
  if (!damageDocumented) gaps.push('Document mitigation expenses or obtain fair-market-value evidence.');
  if (!taxYearMatches) gaps.push('Confirm the claim is presented within the tax year in which the supporting events occurred.');
  return {
    statute: 'O.C.G.A. § 36-60-34',
    bill: 'GA HB 295 (2025-2026 Regular Session)',
    remedy: 'A qualifying real-property owner may seek compensation from the local government; this is not payment for submitting a report.',
    warning: 'This is an evidence checklist for attorney review, not a reporter bounty and not a legal conclusion, valuation, or claim filing.',
    coverage: {
      owner: { status: checklistStatus(ownerDocumented), owner_type: input.owner_type || null },
      parcel: { status: checklistStatus(parcelDocumented), parcel_id: input.parcel_id || null, property_address: input.property_address || null },
      local_government: { status: checklistStatus(governmentDocumented), value: input.local_government || null },
      covered_categories: { status: checklistStatus(categories.length > 0), categories },
      damage: { status: checklistStatus(damageDocumented), documented_expenses: expensesDocumented ? expenseAmount : null, fair_market_value_evidence: valueEvidenceDocumented },
      timing: { status: checklistStatus(taxYearMatches), claim_year: claimYear, event_years: eventYears },
    },
    records: categorized,
    evidence_gaps: gaps,
    attorney_review_ready: gaps.length === 0,
  };
}

module.exports = { COVERED_CATEGORIES, normalizeCategory, buildHB295Checklist };
