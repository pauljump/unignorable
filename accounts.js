const { DatabaseSync } = require('node:sqlite');
const { randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const hash = v => createHash('sha256').update(v).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name+'='))?.slice(name.length+1) || '';
const allowedFilters = new Set(['alpr','homelessness','drugs','dumping','sidewalk','street','signals']);
function cleanWalk(body) {
  const point = p => {
    if (!p || typeof p.name !== 'string' || !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || p.lat < 40.45 || p.lat > 40.95 || p.lng < -74.30 || p.lng > -73.65) throw new Error('Choose valid NYC addresses.');
    return {name:p.name.trim().slice(0,200),lat:p.lat,lng:p.lng};
  };
  if (body.consent !== true) throw new Error('Confirm saving these addresses to your account.');
  if (!Array.isArray(body.filters) || body.filters.length > 20 || body.filters.some(x => typeof x !== 'string' || !allowedFilters.has(x))) throw new Error('Invalid walking preferences.');
  return {name:String(body.name || 'My walk').trim().slice(0,80) || 'My walk', origin:point(body.origin),destination:point(body.destination),via:body.via ? point(body.via) : null,filters:[...new Set(body.filters)].sort()};
}
function createAccountHandler(directory, {origin='https://curbnote.polyfeeds.dev', webauthn}={}) {
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'accounts.db');
  const db=new DatabaseSync(file);fs.chmodSync(file,0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,public_key BLOB NOT NULL,counter INTEGER NOT NULL,transports TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS challenges(hash TEXT PRIMARY KEY,kind TEXT NOT NULL,account_id TEXT NOT NULL,name TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL,binding TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS saved_walks(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,recipe TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS walks_owner ON saved_walks(account_id);`);
  const rpID = new URL(origin).hostname;
  const auth=()=> webauthn ? Promise.resolve(webauthn) : import('@simplewebauthn/server');
  const getSession=req=>{
    const bearer=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
    const token=bearer || cookie(req,'__Host-curbnote');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return db.prepare('SELECT s.*,a.name FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.hash=? AND s.expires>?').get(hash(token),Date.now());
  };
  const handler=async({req,res,u,send,readBody,rateLimited})=>{
    const json=(code,value)=>send(res,code,JSON.stringify(value),'application/json',{'Cache-Control':'no-store'});
    if(u.pathname==='/.well-known/apple-app-site-association') {send(res,200,JSON.stringify({webcredentials:{apps:['99US464DK4.com.curbnote.app']}}),'application/json',{'Cache-Control':'public, max-age=300'});return true;}
    if(['/account','/account-client.js','/passkey-browser.js'].includes(u.pathname)&&req.method==='GET') {
      const file=u.pathname==='/account'?'account.html':u.pathname==='/account-client.js'?'account-client.js':'node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js';
      send(res,200,fs.readFileSync(path.join(__dirname,file)),u.pathname==='/account'?'text/html; charset=utf-8':'text/javascript',{'Cache-Control':'no-store'});return true;
    }
    if(!u.pathname.startsWith('/api/account'))return false;
    const native=!req.headers.origin && !req.headers['sec-fetch-site'] && req.headers['x-curbnote-client']==='ios';
    const session=getSession(req);
    try {
      if(req.method!=='GET'){
        if(req.headers['sec-fetch-site']==='cross-site'||(!native&&req.headers.origin!==origin)||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){json(403,{error:'Use Curbnote to manage your account.'});return true;}
        if(rateLimited(req)){json(429,{error:'Please wait before trying again.'});return true;}
      }
      if(u.pathname==='/api/account/session'&&req.method==='GET'){json(200,{account:session?{id:session.account_id,name:session.name}:null});return true;}
      if(u.pathname==='/api/account/passkey/options'&&req.method==='POST'){
        const body=await readBody(req),kind=body.kind;
        if(!['register','login','add'].includes(kind))throw new Error('Choose create account or sign in.');
        if(kind==='register'&&session)throw new Error('Already signed in.');
        if(kind==='add'&&(!session||Date.now()-session.created_at>300000)){json(401,{error:'Sign in again before adding a passkey.'});return true;}
        const name=String(body.name||'Curbnote walker').trim().slice(0,50)||'Curbnote walker';
        const accountId=kind==='add'?session.account_id:random();
        const lib=await auth();
        const keys=kind==='add'?db.prepare('SELECT id FROM passkeys WHERE account_id=?').all(accountId):[];
        if(keys.length>=5)throw new Error('This account already has five passkeys.');
        const options=kind==='login'?await lib.generateAuthenticationOptions({rpID,userVerification:'required'}):await lib.generateRegistrationOptions({rpID,rpName:'Curbnote',userID:Buffer.from(accountId,'base64url'),userName:name,userDisplayName:name,attestationType:'none',authenticatorSelection:{residentKey:'required',userVerification:'required'},supportedAlgorithmIDs:[-7,-257],excludeCredentials:keys});
        const flow=random(),binding=native?'native':random();
        db.prepare('DELETE FROM challenges WHERE expires<?').run(Date.now());
        db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
        if(db.prepare('SELECT count(*) AS n FROM challenges').get().n>=1000){json(429,{error:'Please try again shortly.'});return true;}
        db.prepare('INSERT INTO challenges VALUES(?,?,?,?,?,?,?)').run(hash(flow),kind,accountId,kind==='add'?session.name:name,options.challenge,Date.now()+300000,hash(binding));
        if(!native)res.setHeader('Set-Cookie',`__Host-curbnote-flow=${binding}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=300`);
        json(200,{flow,options});return true;
      }
      if(u.pathname==='/api/account/passkey/verify'&&req.method==='POST'){
        const body=await readBody(req);
        if(typeof body.flow!=='string'||body.flow.length!==43)throw new Error('Sign-in expired. Please retry.');
        const challenge=db.prepare('DELETE FROM challenges WHERE hash=? RETURNING *').get(hash(body.flow));
        if(!challenge||challenge.expires<Date.now()||challenge.binding!==hash(native?'native':cookie(req,'__Host-curbnote-flow')))throw new Error('Sign-in expired. Please retry.');
        const lib=await auth();let accountId=challenge.account_id;
        if(challenge.kind==='login'){
          const key=db.prepare('SELECT * FROM passkeys WHERE id=?').get(String(body.credential?.id||''));
          if(!key)throw new Error('Passkey not recognized.');
          const result=await lib.verifyAuthenticationResponse({response:body.credential,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:key.id,publicKey:new Uint8Array(key.public_key),counter:key.counter,transports:JSON.parse(key.transports)}});
          if(!result.verified)throw new Error('Could not verify this passkey.');
          if(body.credential.response.userHandle&&body.credential.response.userHandle!==key.account_id)throw new Error('Passkey account mismatch.');
          db.prepare('UPDATE passkeys SET counter=? WHERE id=?').run(result.authenticationInfo.newCounter,key.id);accountId=key.account_id;
        }else{
          if(challenge.kind==='add'&&(!session||session.account_id!==accountId||Date.now()-session.created_at>300000))throw new Error('Sign in again before adding a passkey.');
          const result=await lib.verifyRegistrationResponse({response:body.credential,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});
          if(!result.verified||!result.registrationInfo)throw new Error('Could not verify this passkey.');
          const key=result.registrationInfo.credential;
          db.exec('BEGIN');try{
            if(challenge.kind==='register')db.prepare('INSERT INTO accounts VALUES(?,?,?)').run(accountId,challenge.name,Date.now());
            db.prepare('INSERT INTO passkeys VALUES(?,?,?,?,?)').run(key.id,accountId,Buffer.from(key.publicKey),key.counter,JSON.stringify(key.transports||[]));db.exec('COMMIT');
          }catch(e){db.exec('ROLLBACK');throw e;}
        }
        const token=random();
        if(session)db.prepare('DELETE FROM sessions WHERE hash=?').run(session.hash);
        db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),accountId,Date.now(),Date.now()+30*86400000);
        if(!native)res.setHeader('Set-Cookie',`__Host-curbnote=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`);
        const account=db.prepare('SELECT id,name FROM accounts WHERE id=?').get(accountId);
        json(200,{account,...(native?{token}:{})});return true;
      }
      if(!session){json(401,{error:'Sign in to save walks across devices.'});return true;}
      if(u.pathname==='/api/account/logout'&&req.method==='POST'){
        db.prepare('DELETE FROM sessions WHERE hash=?').run(session.hash);
        res.setHeader('Set-Cookie','__Host-curbnote=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');json(200,{ok:true});return true;
      }
      if(u.pathname==='/api/account/delete'&&req.method==='POST'){
        if(Date.now()-session.created_at>300000){json(401,{error:'Sign in again to delete your account.'});return true;}
        const body=await readBody(req);if(body.confirm!==true)throw new Error('Confirm account deletion.');
        db.prepare('DELETE FROM accounts WHERE id=?').run(session.account_id);
        res.setHeader('Set-Cookie','__Host-curbnote=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');json(200,{ok:true});return true;
      }
      if(u.pathname==='/api/account/walks'&&req.method==='GET'){
        json(200,{walks:db.prepare('SELECT id,recipe,updated_at FROM saved_walks WHERE account_id=? ORDER BY updated_at DESC').all(session.account_id).map(row=>({id:row.id,...JSON.parse(row.recipe),updatedAt:row.updated_at}))});return true;
      }
      if(u.pathname==='/api/account/walks'&&req.method==='POST'){
        const recipe=cleanWalk(await readBody(req));
        const existing=db.prepare('SELECT id FROM saved_walks WHERE account_id=? AND recipe=?').get(session.account_id,JSON.stringify(recipe));
        if(existing){json(200,{id:existing.id});return true;}
        if(db.prepare('SELECT count(*) AS n FROM saved_walks WHERE account_id=?').get(session.account_id).n>=30)throw new Error('Remove a saved walk before adding another. Limit: 30.');
        const id=random();db.prepare('INSERT INTO saved_walks VALUES(?,?,?,?)').run(id,session.account_id,JSON.stringify(recipe),Date.now());json(201,{id});return true;
      }
      if(u.pathname==='/api/account/walks/remove'&&req.method==='POST'){
        const body=await readBody(req);db.prepare('DELETE FROM saved_walks WHERE id=? AND account_id=?').run(String(body.id||''),session.account_id);json(200,{ok:true});return true;
      }
      json(404,{error:'Not found.'});return true;
    }catch(error){json(400,{error: /^(Choose|Confirm|Invalid|Sign|Already|This account|Passkey|Could not|Remove)/.test(error.message)?error.message:'Could not complete that request. Please try again.'});return true;}
  };
  handler.close=()=>db.close();return handler;
}
module.exports={createAccountHandler,cleanWalk};
