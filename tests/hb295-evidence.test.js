const test = require('node:test');
const assert = require('node:assert/strict');
const { COVERED_CATEGORIES, normalizeCategory, buildHB295Checklist } = require('../hb295-evidence');

test('HB 295 categories are explicit and aliases do not create a legal conclusion', () => {
  assert.equal(COVERED_CATEGORIES.length, 7);
  assert.equal(normalizeCategory('Encampment / camping complaint'), 'illegal public camping');
  assert.equal(normalizeCategory('Drug activity'), 'possession or use of controlled substances');
  assert.equal(normalizeCategory('noise complaint'), null);
});

test('HB 295 checklist reports missing proof instead of treating 311 closure as resolution', () => {
  const result = buildHB295Checklist({
    owner_type: 'fee_simple',
    property_address: '100 Example Street SW, Atlanta, GA',
    local_government: 'city_of_atlanta',
    claim_year: 2026,
    records: [{ id: 'ATL-1', type: 'Encampment', opened_at: '2026-08-01', status: 'Closed' }],
  });
  assert.equal(result.attorney_review_ready, false);
  assert.equal(result.records[0].category, 'illegal public camping');
  assert.match(result.evidence_gaps.join(' '), /mitigation expenses|fair-market-value/i);
  assert.match(result.warning, /not a legal conclusion/i);
  assert.match(result.warning, /not a reporter bounty/i);
  assert.match(result.remedy, /not payment for submitting a report/i);
});

test('complete checklist requires a damage path and matching tax year', () => {
  const result = buildHB295Checklist({
    owner_type: 'leasehold',
    parcel_id: 'ATL-PARCEL-1',
    local_government: 'city_of_atlanta',
    claim_year: 2026,
    documented_expenses: 1250,
    records: [
      { id: 'ATL-1', category: 'illegal public camping', opened_at: '2026-08-01', source_url: 'https://www.atl311.com/' },
      { id: 'ATL-2', category: 'panhandling', opened_at: '2026-09-02', source_url: 'https://www.atl311.com/' },
    ],
  });
  assert.equal(result.attorney_review_ready, true);
  assert.equal(result.coverage.damage.documented_expenses, 1250);
  assert.deepEqual(result.coverage.covered_categories.categories, ['illegal public camping', 'panhandling']);
});
