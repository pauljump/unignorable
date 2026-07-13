// Spot inspector — pull the RAW 311 points near a location (not the rounded cells) and run DBSCAN
// so we can SEE whether a place is one encampment or several, transparently. Investigative tool.
//   node scripts/inspect-spot.js <lat> <lng> [radiusM=200] [epsM=40] [minPts=3]
const { DatabaseSync } = require('node:sqlite');
const DB = process.env.DB || '/Users/mini-home/Desktop/Monorepo/sidewalk/data/sidewalk.db';
const db = new DatabaseSync(DB, { readOnly: true });

const [LAT, LNG, R = 200, EPS = 40, MINPTS = 3] = process.argv.slice(2).map(Number);
if (!Number.isFinite(LAT) || !Number.isFinite(LNG)) { console.error('usage: node inspect-spot.js <lat> <lng> [radiusM] [epsM] [minPts]'); process.exit(1); }

const R_EARTH = 6371000, rad = Math.PI / 180;
const dist = (a, b, c, d) => { const dy = (c - a) * rad, dx = (d - b) * rad, la = a * rad, lc = c * rad; const h = Math.sin(dy / 2) ** 2 + Math.cos(la) * Math.cos(lc) * Math.sin(dx / 2) ** 2; return 2 * R_EARTH * Math.asin(Math.sqrt(h)); };

const TYPES = "('Encampment','Homeless Person Assistance','Drug Activity','Panhandling')";
// crude bbox prefilter (1 deg lat ~111km), then exact haversine
const dLat = R / 111000, dLng = R / (111000 * Math.cos(LAT * rad));
const rows = db.prepare(`
  SELECT CAST(latitude AS REAL) AS lat, CAST(longitude AS REAL) AS lng, complaint_type AS type,
         incident_address AS addr, cross_street_1 AS x1, cross_street_2 AS x2, descriptor,
         open_data_channel_type AS chan, date(created_date) AS d, resolution_description AS res
  FROM sr311
  WHERE latitude IS NOT NULL AND complaint_type IN ${TYPES}
    AND CAST(latitude AS REAL) BETWEEN ? AND ? AND CAST(longitude AS REAL) BETWEEN ? AND ?
`).all(LAT - dLat, LAT + dLat, LNG - dLng, LNG + dLng)
  .map(r => ({ ...r, m: dist(LAT, LNG, r.lat, r.lng) }))
  .filter(r => r.m <= R);

console.log(`\n=== ${rows.length} raw 311 points within ${R}m of ${LAT},${LNG} ===`);

// --- location-noise diagnostics: how precise is the city's own geocoding here? ---
const uniqPts = new Set(rows.map(r => r.lat.toFixed(5) + ',' + r.lng.toFixed(5)));
const uniqAddr = new Set(rows.map(r => (r.addr || '').trim().toUpperCase()).filter(Boolean));
const chans = rows.reduce((a, r) => (a[r.chan || '?'] = (a[r.chan || '?'] || 0) + 1, a), {});
console.log(`distinct GPS points: ${uniqPts.size}  |  distinct addresses: ${uniqAddr.size}  |  channels: ${JSON.stringify(chans)}`);
console.log('(few distinct GPS points but many addresses ⇒ the city snaps reports to a handful of geocoded nodes — precision is coarse)\n');

// --- DBSCAN (eps in meters) on the raw points ---
const N = rows.length, label = new Array(N).fill(0); // 0=unvisited, -1=noise, >0=cluster id
const neighbors = (i) => { const out = []; for (let j = 0; j < N; j++) if (i !== j && dist(rows[i].lat, rows[i].lng, rows[j].lat, rows[j].lng) <= EPS) out.push(j); return out; };
let cid = 0;
for (let i = 0; i < N; i++) {
  if (label[i] !== 0) continue;
  const nb = neighbors(i);
  if (nb.length + 1 < MINPTS) { label[i] = -1; continue; }
  cid++; label[i] = cid;
  const queue = [...nb];
  for (let q = 0; q < queue.length; q++) {
    const j = queue[q];
    if (label[j] === -1) label[j] = cid;
    if (label[j] !== 0) continue;
    label[j] = cid;
    const nb2 = neighbors(j);
    if (nb2.length + 1 >= MINPTS) for (const k of nb2) if (!queue.includes(k)) queue.push(k);
  }
}

const NF = /no Encampment was found|observed no encampment|could not find|could not locate|did not observe|no one was/i;
const clusters = {};
for (let i = 0; i < N; i++) { const c = label[i]; (clusters[c] = clusters[c] || []).push(rows[i]); }
const order = Object.keys(clusters).map(Number).filter(c => c > 0).sort((a, b) => clusters[b].length - clusters[a].length);

console.log(`DBSCAN(eps=${EPS}m, minPts=${MINPTS}) → ${order.length} candidate spot(s)` + (clusters[-1] ? ` + ${clusters[-1].length} noise` : '') + ':\n');
for (const c of order) {
  const pts = clusters[c];
  const clat = pts.reduce((s, r) => s + r.lat, 0) / pts.length, clng = pts.reduce((s, r) => s + r.lng, 0) / pts.length;
  const span = [pts.reduce((m, r) => r.d < m ? r.d : m, '9999'), pts.reduce((m, r) => r.d > m ? r.d : m, '0')];
  const types = pts.reduce((a, r) => (a[r.type] = (a[r.type] || 0) + 1, a), {});
  const addrTop = Object.entries(pts.reduce((a, r) => (a[(r.addr || '?').trim()] = (a[(r.addr || '?').trim()] || 0) + 1, a), {})).sort((x, y) => y[1] - x[1]).slice(0, 4);
  const xstreets = Object.entries(pts.reduce((a, r) => { const k = [r.x1, r.x2].filter(Boolean).join(' & '); if (k) a[k] = (a[k] || 0) + 1; return a; }, {})).sort((x, y) => y[1] - x[1]).slice(0, 3);
  const nf = pts.filter(r => NF.test(r.res || '')).length;
  const radM = Math.max(...pts.map(r => dist(clat, clng, r.lat, r.lng)));
  console.log(`SPOT ${c}: ${pts.length} reports  @ ${clat.toFixed(5)},${clng.toFixed(5)}  spread≤${radM.toFixed(0)}m  ${span[0]}→${span[1]}`);
  console.log(`   types: ${JSON.stringify(types)}   nothing-found: ${nf}`);
  console.log(`   top addresses: ${addrTop.map(([a, n]) => `${a}(${n})`).join(', ')}`);
  console.log(`   cross-streets: ${xstreets.map(([a, n]) => `${a}(${n})`).join(', ') || '—'}\n`);
}
