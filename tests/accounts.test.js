const test=require('node:test');const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const path=require('node:path');
const crypto=require('node:crypto');const {encodeCBOR}=require('@levischuck/tiny-cbor');
const {createAccountHandler,cleanWalk}=require('../accounts');
const origin='https://curbnote.polyfeeds.dev',rpID='curbnote.polyfeeds.dev';
const digest=b=>crypto.createHash('sha256').update(b).digest();
const b64=b=>Buffer.from(b).toString('base64url');
function authenticator(){const keys=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});return{...keys,id:crypto.randomBytes(32)};}
function registration(a,options,{site=origin,uv=true}={}){
 const jwk=a.publicKey.export({format:'jwk'});const cose=encodeCBOR(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));
 const length=Buffer.alloc(2);length.writeUInt16BE(a.id.length);
 const data=Buffer.concat([digest(rpID),Buffer.from([uv?0x45:0x41]),Buffer.alloc(4),Buffer.alloc(16),length,a.id,Buffer.from(cose)]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:options.challenge,origin:site,crossOrigin:false}));
 return{id:b64(a.id),rawId:b64(a.id),type:'public-key',response:{clientDataJSON:b64(client),attestationObject:b64(encodeCBOR(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(data)]]))),transports:['internal']},clientExtensionResults:{}};
}
function assertion(a,options,{site=origin,userHandle,counter=1,uv=true}={}){
 const count=Buffer.alloc(4);count.writeUInt32BE(counter);
 const data=Buffer.concat([digest(rpID),Buffer.from([uv?5:1]),count]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:options.challenge,origin:site,crossOrigin:false}));
 const signature=crypto.sign('sha256',Buffer.concat([data,digest(client)]),a.privateKey);
 return{id:b64(a.id),rawId:b64(a.id),type:'public-key',response:{clientDataJSON:b64(client),authenticatorData:b64(data),signature:b64(signature),...(userHandle?{userHandle}:{})},clientExtensionResults:{}};
}
function setup(t){const dir=mkdtempSync(path.join(tmpdir(),'curbnote-accounts-'));const handler=createAccountHandler(dir,{origin});t.after(()=>{handler.close();rmSync(dir,{recursive:true,force:true});});
 return async function call(url,{body,token,headers={},native=true,method}={}){
  const req={method:method||(body===undefined?'GET':'POST'),headers:{...(native?{'x-curbnote-client':'ios'}:{origin}),...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{}),...headers}};
  let out={};const res={setHeader(k,v){out[k.toLowerCase()]=v;}};
  await handler({req,res,u:new URL(url,origin),readBody:async()=>body,rateLimited:()=>false,send:(_res,status,data,type)=>{out.status=status;out.body=type==='application/json'?JSON.parse(data):data;}});return out;
 };
}
const recipe={name:'Regular walk',origin:{name:'A',lat:40.74,lng:-73.99},destination:{name:'B',lat:40.75,lng:-73.98},via:null,filters:['sidewalk'],consent:true};
async function signup(call){const a=authenticator();const begin=await call('/api/account/passkey/options',{body:{kind:'register',name:'Walker'}});assert.equal(begin.status,200);const credential=registration(a,begin.body.options);const finish=await call('/api/account/passkey/verify',{body:{flow:begin.body.flow,credential}});assert.equal(finish.status,200,JSON.stringify(finish.body));return{a,token:finish.body.token,id:finish.body.account.id,flow:begin.body.flow,credential};}
test('real passkey signup/login, private saved walks, logout and account deletion',async t=>{
 const call=setup(t);const one=await signup(call),two=await signup(call);
 assert.equal((await call('/api/account/walks')).status,401);
 const saved=await call('/api/account/walks',{token:one.token,body:recipe});assert.equal(saved.status,201);
 assert.equal((await call('/api/account/walks',{token:two.token})).body.walks.length,0);
 await call('/api/account/walks/remove',{token:two.token,body:{id:saved.body.id}});
 assert.equal((await call('/api/account/walks',{token:one.token})).body.walks.length,1);
 assert.equal((await call('/api/account/walks',{token:one.token,body:recipe})).body.id,saved.body.id);
 const begin=await call('/api/account/passkey/options',{body:{kind:'login'}});
 const finish=await call('/api/account/passkey/verify',{body:{flow:begin.body.flow,credential:assertion(one.a,begin.body.options,{userHandle:one.id})}});
 assert.equal(finish.status,200,JSON.stringify(finish.body));assert.equal(finish.body.account.id,one.id);
 await call('/api/account/logout',{token:one.token,body:{}});assert.equal((await call('/api/account/walks',{token:one.token})).status,401);
 assert.equal((await call('/api/account/delete',{token:finish.body.token,body:{confirm:true}})).status,200);
 assert.equal((await call('/api/account/walks',{token:finish.body.token})).status,401);
 const gone=await call('/api/account/passkey/options',{body:{kind:'login'}});
 assert.equal((await call('/api/account/passkey/verify',{body:{flow:gone.body.flow,credential:assertion(one.a,gone.body.options,{counter:2})}})).status,400);
});
test('rejects replay, wrong origin, missing user verification, tampering and cross-site mutations',async t=>{
 const call=setup(t),user=await signup(call);
 assert.equal((await call('/api/account/passkey/verify',{body:{flow:user.flow,credential:user.credential}})).status,400);
 for(const config of [{site:'https://evil.example'},{uv:false}]){
  const begin=await call('/api/account/passkey/options',{body:{kind:'login'}});
  assert.equal((await call('/api/account/passkey/verify',{body:{flow:begin.body.flow,credential:assertion(user.a,begin.body.options,config)}})).status,400);
 }
 const begin=await call('/api/account/passkey/options',{body:{kind:'login'}});const proof=assertion(user.a,begin.body.options);proof.response.signature=b64(crypto.randomBytes(72));
 assert.equal((await call('/api/account/passkey/verify',{body:{flow:begin.body.flow,credential:proof}})).status,400);
 assert.equal((await call('/api/account/walks',{token:user.token,body:recipe,headers:{origin:'https://evil.example'}})).status,403);
 assert.equal((await call('/api/account/walks',{token:user.token,body:{...recipe,consent:false}})).status,400);
});
test('browser registration is bound to its flow cookie and never exposes a bearer token',async t=>{
 const call=setup(t),a=authenticator();
 let begin=await call('/api/account/passkey/options',{native:false,body:{kind:'register',name:'Browser'}});
 assert.equal((await call('/api/account/passkey/verify',{native:false,body:{flow:begin.body.flow,credential:registration(a,begin.body.options)}})).status,400);
 begin=await call('/api/account/passkey/options',{native:false,body:{kind:'register',name:'Browser'}});
 const result=await call('/api/account/passkey/verify',{native:false,headers:{cookie:begin['set-cookie'].split(';')[0]},body:{flow:begin.body.flow,credential:registration(a,begin.body.options)}});
 assert.equal(result.status,200);assert.equal(result.body.token,undefined);assert.match(result['set-cookie'],/Secure; HttpOnly; SameSite=Strict/);
 const session=await call('/api/account/session',{native:false,headers:{cookie:result['set-cookie'].split(';')[0]}});assert.equal(session.body.account.name,'Browser');
});
test('saved walk validation only retains allowed fields and valid NYC coordinates',()=>{
 assert.deepEqual(Object.keys(cleanWalk({...recipe,history:['private'],token:'secret'})).sort(),['destination','filters','name','origin','via']);
 assert.throws(()=>cleanWalk({...recipe,origin:{...recipe.origin,lat:0}}));assert.throws(()=>cleanWalk({...recipe,filters:['unsupported']}));
});
test('additional passkeys belong to the signed-in account and require authentication',async t=>{
 const call=setup(t);assert.equal((await call('/api/account/passkey/options',{body:{kind:'add'}})).status,401);
 const user=await signup(call),second=authenticator();
 const begin=await call('/api/account/passkey/options',{token:user.token,body:{kind:'add'}});
 assert.equal(begin.body.options.user.id,user.id);
 const finish=await call('/api/account/passkey/verify',{token:user.token,body:{flow:begin.body.flow,credential:registration(second,begin.body.options)}});
 assert.equal(finish.status,200);assert.equal(finish.body.account.id,user.id);
 const login=await call('/api/account/passkey/options',{body:{kind:'login'}});
 const signedIn=await call('/api/account/passkey/verify',{body:{flow:login.body.flow,credential:assertion(second,login.body.options,{userHandle:user.id})}});
 assert.equal(signedIn.status,200);assert.equal(signedIn.body.account.id,user.id);
});
