// Idempotent seed: creates campaign #1 for the canary issue.
// Safe to run multiple times — INSERT OR IGNORE in startCampaign means no duplicate.
// Usage: node scripts/seed-campaign.js
const ugc = require('../ugc');

const CANARY_KEY = 'Encampment|40.736,-73.983';
const row = ugc.startCampaign(CANARY_KEY);
console.log('campaign row:', JSON.stringify(row, null, 2));
