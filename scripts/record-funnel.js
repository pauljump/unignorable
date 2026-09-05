// Read-only, local diagnostics. Never import ugc.js: it performs startup migrations.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = new DatabaseSync(path.join(dir, 'ugc.db'), { readOnly: true });
const since = new Date(Date.now() - 30 * 86400000).toISOString();
const hasEvents = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='record_event_counts'").get();
const report = {
  window: { since, through: new Date().toISOString(), event_day_boundary: 'UTC aggregates include the whole boundary day; observation/action timestamps use the exact cutoff' },
  traffic_and_activation: hasEvents ? db.prepare('SELECT feature_id,event,sum(count) count FROM record_event_counts WHERE day>=? GROUP BY feature_id,event ORDER BY feature_id,event').all(since.slice(0, 10)) : [],
  evidence_quality: db.prepare('SELECT feature_id,state,review_status,count(*) checks,count(distinct observation_day) check_days FROM condition_observations WHERE submitted_at>=? GROUP BY feature_id,state,review_status ORDER BY feature_id,state,review_status').all(since),
  actions_prepared: db.prepare('SELECT issue_key,count(*) prepared FROM action_receipts WHERE created_at>=? GROUP BY issue_key').all(since),
  actions_sender_confirmed: db.prepare('SELECT issue_key,count(*) sender_confirmed FROM action_receipts WHERE sender_confirmed_at>=? GROUP BY issue_key').all(since),
  real_world_resolution: { official_responses: null, verified_resolved_condition_days: null, source: 'Manual pilot ledger required; no historical outcome event store exists.' },
  limitations: [
    'Browser-tab events are aggregate proxies, not unique people, verified acquisition, or attributable conversions. Bots can submit events.',
    'Observation rows are deduplicated by connection/site/day; independent people and alias overlap require manual review.',
    'A prepared action is not sent. Sender confirmation is an assertion, not delivery proof. Link requests are not official responses.',
    'Review turnaround requires the coordinator log: the existing review schema does not store decision timestamps.',
    'This report covers all recorded sites; use the pilot IDs and related legacy issue keys to identify the enrolled cohort.'
  ]
};
db.close();
console.log(JSON.stringify(report, null, 2));
