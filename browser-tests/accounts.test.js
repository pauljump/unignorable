const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {chromium}=require('@playwright/test');const {createAccountHandler}=require('../accounts');
const origin='https://curbnote.polyfeeds.dev';
test('mobile web signup, explicit save, login, reopen and account deletion with a virtual passkey',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'curbnote-browser-'));const handler=createAccountHandler(dir,{origin});
 const server=http.createServer(async(req,res)=>{const u=new URL(req.url,origin);const send=(r,status,data,type,headers={})=>{r.writeHead(status,{'content-type':type,...headers});r.end(data);};
 if(u.pathname==='/'){send(res,200,fs.readFileSync(path.join(__dirname,'../index.html')),'text/html');return;}
 if(['/launch-client.js','/webmcp.js'].includes(u.pathname)||u.pathname.startsWith('/vendor/')||u.pathname.startsWith('/assets/brand/')){
   const file=path.resolve(__dirname,'..','.'+u.pathname);
   if(!file.startsWith(path.resolve(__dirname,'..')+path.sep)){send(res,403,'','text/plain');return;}
   if(fs.existsSync(file)){send(res,200,fs.readFileSync(file),file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'image/png');return;}
 }
 if(u.pathname==='/api/access'){send(res,200,JSON.stringify({active:true,plan:'bypass'}),'application/json');return;}
 if(u.pathname==='/api/map-layers'){send(res,200,JSON.stringify({layers:{},meta:{}}),'application/json');return;}
 if(u.pathname==='/api/report-issues'){send(res,200,'[]','application/json');return;}
 if(u.pathname==='/launch.css'){send(res,200,fs.readFileSync(path.join(__dirname,'../launch.css')),'text/css');return;}
 let body='';for await(const chunk of req)body+=chunk;
 if(!await handler({req,res,u,send,readBody:async()=>JSON.parse(body),rateLimited:()=>false}))send(res,404,'Not found','text/plain');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 t.after(async()=>{await browser.close();await new Promise(r=>server.close(r));handler.close();fs.rmSync(dir,{recursive:true,force:true});});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();const response=await route.fetch({url:`http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`});await route.fulfill({response});});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
 const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 await page.goto(origin+'/account');await page.locator('#register').waitFor({state:'visible'});
 assert.equal(await page.locator('#save').isVisible(),false);
 await page.locator('#account-name').fill('Test walker');await page.locator('#register').click();await page.locator('#library').waitFor({state:'visible'});
 await page.evaluate(()=>sessionStorage.setItem('curbnote-pending-walk',JSON.stringify({at:Date.now(),walk:{origin:{name:'350 5th Avenue',lat:40.748,lng:-73.985},destination:{name:'247 Third Avenue',lat:40.737,lng:-73.984},via:null,filters:['sidewalk']}})));
 await page.reload();await page.locator('#save').waitFor({state:'visible'});assert.equal(await page.locator('#walks article').count(),0);
 await page.locator('#walk-name').fill('My usual walk');await page.screenshot({path:'/tmp/curbnote-account-web.png',fullPage:true});
 await page.locator('#save-walk').click();await page.getByRole('heading',{name:'My usual walk'}).waitFor();assert.equal(await page.locator('#save').isVisible(),false);
 await page.locator('summary').click();await page.locator('#logout').click();await page.locator('#login').waitFor({state:'visible'});
 // Discoverable passkey login must recover the same private library.
 await page.locator('#login').click();await page.getByRole('heading',{name:'My usual walk'}).waitFor();
 await page.getByRole('button',{name:'Use these addresses'}).click();await page.waitForURL('**/?savedWalk=1');
 await page.locator('#origin').waitFor({state:'visible'});assert.equal(await page.locator('#origin').inputValue(),'350 5th Avenue');assert.equal(await page.locator('#destination').inputValue(),'247 Third Avenue');await page.waitForFunction(()=>document.querySelector('[data-layer=sidewalk]')?.getAttribute('aria-pressed')==='true');
 await page.goto(origin+'/account');await page.locator('#library').waitFor({state:'visible'});await page.locator('summary').click();
 page.once('dialog',dialog=>dialog.accept());await page.locator('#delete-account').click();await page.locator('#register').waitFor({state:'visible'});
 assert.equal(errors.length,0,errors.join('\n'));await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId});
});
