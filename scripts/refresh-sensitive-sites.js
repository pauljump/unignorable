// Refresh the compact school/childcare proximity index from NYC Planning's Facilities Database.
// Public Socrata dataset ji82-xba5; no token or paid service required.
const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const OUT = path.join(DATA_DIR, 'sensitive_sites.json');
const SOURCE = 'https://data.cityofnewyork.us/City-Government/Facilities-Database/ji82-xba5';
const query = new URLSearchParams({
  '$select': 'uid,facname,address,facgroup,factype,latitude,longitude,datasource',
  '$where': "facgroup in ('SCHOOLS (K-12)','DAY CARE AND PRE-KINDERGARTEN') AND latitude IS NOT NULL AND longitude IS NOT NULL",
  '$limit': '50000',
});
const url = `https://data.cityofnewyork.us/resource/ji82-xba5.json?${query}`;

https.get(url, { headers: { 'User-Agent': 'unignorable/1.0 (+https://unignorable.polyfeeds.dev)' } }, response => {
  if (response.statusCode !== 200) throw new Error(`facilities request failed: HTTP ${response.statusCode}`);
  let body = '';
  response.on('data', chunk => body += chunk);
  response.on('end', () => {
    const rows = JSON.parse(body);
    const sites = rows.map(row => ({
      id: row.uid,
      name: row.facname,
      address: row.address || null,
      category: row.facgroup === 'SCHOOLS (K-12)' ? 'school' : 'childcare',
      type: row.factype || null,
      lat: Number(row.latitude),
      lng: Number(row.longitude),
      source_record: row.datasource || null,
    })).filter(row => row.id && row.name && Number.isFinite(row.lat) && Number.isFinite(row.lng));
    const payload = {
      dataset: 'NYC Planning Facilities Database',
      dataset_id: 'ji82-xba5',
      source: SOURCE,
      refreshed_at: new Date().toISOString(),
      categories: ['SCHOOLS (K-12)', 'DAY CARE AND PRE-KINDERGARTEN'],
      sites,
    };
    const tmp = OUT + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, OUT);
    console.log(`refreshed ${sites.length} sensitive sites`);
  });
}).on('error', error => { throw error; });
