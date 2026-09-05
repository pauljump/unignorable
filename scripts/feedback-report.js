// Read-only launch feedback diagnostics; no message text, identifiers or coordinates.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(process.env.DATA_DIR || path.join(__dirname,'../data'),'feedback.db');
if (!fs.existsSync(file)) { console.log('No feedback database yet.'); process.exit(0); }
const db = new DatabaseSync(file,{readOnly:true});
const since=new Date(Date.now()-30*86400000).toISOString();
for(const dimension of ['platform','category','usefulness','status']){
 console.log(dimension,JSON.stringify(db.prepare(`SELECT ${dimension},count(*) AS submissions FROM feedback WHERE created_at>=? GROUP BY ${dimension}`).all(since)));
}
console.log('Submission counts, not unique people or completed walks. Last 30 days only.');
db.close();
