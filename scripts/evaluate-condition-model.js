#!/usr/bin/env node
// Forward-looking proxy validation for the encampment state model.
//
// NYC does not publish a live site inventory or scheduled repeated surveys, so later 311 activity
// is a corroboration proxy—not physical ground truth. This report is intentionally explicit about
// that limitation and is used to verify evidence ordering and detect disposition drift.

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB = process.env.DB || path.join(process.env.SIDEWALK_DIR || '/Users/mini-home/Desktop/Monorepo/sidewalk', 'data', 'sidewalk.db');
const db = new DatabaseSync(DB, { readOnly: true });

const recurrenceSql = `WITH raw AS (
  SELECT printf('%.4f,%.4f',cast(latitude AS real),cast(longitude AS real)) site,
    date(created_date) day,lower(coalesce(resolution_description,'')) resolution
  FROM sr311 WHERE complaint_type='Encampment' AND created_date>='2022-01-01'
    AND latitude IS NOT NULL AND longitude IS NOT NULL
), daily AS (
  SELECT site,day,
    max(resolution LIKE '%observed an encampment%') observed,
    max(resolution LIKE '%observed no encampment%' OR resolution LIKE '%no encampment was found%'
      OR resolution LIKE '%could not find the condition%') not_observed,
    max(resolution LIKE '%condition was corrected%') corrected
  FROM raw GROUP BY site,day
), sequenced AS (
  SELECT *,lead(day) OVER (PARTITION BY site ORDER BY day) next_day FROM daily
), labeled AS (
  SELECT CASE WHEN observed THEN 'observed' WHEN not_observed THEN 'not_observed'
    WHEN corrected THEN 'temporary_correction' ELSE 'report_only' END evidence,
    julianday(next_day)-julianday(day) gap
  FROM sequenced WHERE day<'2026-05-01'
)
SELECT evidence,count(*) observations,
  round(avg(gap<=7),3) corroborated_7d,
  round(avg(gap<=14),3) corroborated_14d,
  round(avg(gap<=30),3) corroborated_30d,
  round(avg(gap),1) mean_days_to_next_report
FROM labeled GROUP BY evidence ORDER BY observations DESC`;

const correctionSql = `WITH raw AS (
  SELECT printf('%.4f,%.4f',cast(latitude AS real),cast(longitude AS real)) site,
    date(created_date) day,lower(coalesce(resolution_description,'')) resolution
  FROM sr311 WHERE complaint_type='Encampment' AND created_date>='2026-04-01'
    AND latitude IS NOT NULL AND longitude IS NOT NULL
), daily AS (
  SELECT site,day,max(resolution LIKE '%condition was corrected%') corrected FROM raw GROUP BY site,day
), corrected AS (
  SELECT a.site,a.day,(SELECT min(b.day) FROM daily b WHERE b.site=a.site AND b.day>a.day) next_day
  FROM daily a WHERE a.corrected
)
SELECT min(day) first_seen,max(day) last_seen,count(*) corrected_site_days,
  sum(day<=(SELECT date(max(day),'-7 days') FROM daily)) eligible_7d,
  round(avg(CASE WHEN day<=(SELECT date(max(day),'-7 days') FROM daily)
    THEN julianday(next_day)-julianday(day)<=7 END),3) reported_again_7d
FROM corrected`;

const precisionSql = `SELECT count(*) reports,count(distinct printf('%.3f,%.3f',cast(latitude AS real),cast(longitude AS real))) block_cells,
  count(distinct printf('%.4f,%.4f',cast(latitude AS real),cast(longitude AS real))) site_cells,
  count(distinct nullif(trim(incident_address),'')) reported_addresses
FROM sr311 WHERE complaint_type='Encampment' AND created_date>=date('now','-5 years')
  AND latitude IS NOT NULL AND longitude IS NOT NULL`;

const transitionSql = `WITH raw AS (
  SELECT printf('%.4f,%.4f',cast(latitude AS real),cast(longitude AS real)) site,date(created_date) day,
    max(lower(coalesce(resolution_description,'')) LIKE '%observed an encampment%') observed,
    max(lower(coalesce(resolution_description,'')) LIKE '%observed no encampment%'
      OR lower(coalesce(resolution_description,'')) LIKE '%no encampment was found%'
      OR lower(coalesce(resolution_description,'')) LIKE '%could not find the condition%') not_observed
  FROM sr311 WHERE complaint_type='Encampment' AND created_date>='2022-01-01' AND latitude IS NOT NULL GROUP BY 1,2
), gaps AS (
  SELECT julianday((SELECT min(b.day) FROM raw b WHERE b.site=a.site AND b.day>a.day AND b.not_observed))-julianday(a.day) gap
  FROM raw a WHERE a.observed
), ranked AS (
  SELECT gap,row_number() OVER(ORDER BY gap) rank,count(*) OVER() total FROM gaps WHERE gap IS NOT NULL
)
SELECT min(CASE WHEN rank>=total*.25 THEN gap END) p25_days,
  min(CASE WHEN rank>=total*.50 THEN gap END) median_days,
  min(CASE WHEN rank>=total*.75 THEN gap END) p75_days,count(*) transitions FROM ranked`;

const rows = db.prepare(recurrenceSql).all();
const corrected = db.prepare(correctionSql).get();
const precision = db.prepare(precisionSql).get();
const observedToMiss = db.prepare(transitionSql).get();
db.close();

const byEvidence = Object.fromEntries(rows.map(row => [row.evidence, row]));
const orderingPass = Number(byEvidence.observed?.corroborated_7d) > Number(byEvidence.report_only?.corroborated_7d)
  && Number(byEvidence.report_only?.corroborated_7d) > Number(byEvidence.not_observed?.corroborated_7d);

const report = {
  generated_at: new Date().toISOString(),
  model_target: 'latent current encampment presence near a reported coordinate',
  spatial_precision: precision,
  forward_corroboration: rows,
  temporary_correction_drift: corrected,
  observed_to_later_non_detection: observedToMiss,
  checks: {
    expected_evidence_ordering: orderingPass,
    temporary_correction_is_not_durable_clearance: Number(corrected.reported_again_7d) >= 0.5,
  },
  limitations: [
    'Later 311 activity is a corroboration proxy, not a scheduled physical inspection.',
    'Complaint propensity differs by place and population, so silence cannot identify absence.',
    'Probability calibration against physical truth requires fresh, proximity-verified field observations sampled from both predicted-present and predicted-absent sites.',
  ],
};

console.log(JSON.stringify(report, null, 2));
if (!Object.values(report.checks).every(Boolean)) process.exitCode = 1;
