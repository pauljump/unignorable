'use strict';
(()=>{
 const $=id=>document.getElementById(id);let account=null,pending=null,busy=false;
 const status=text=>{$('status').textContent=text;};
 try{const stored=JSON.parse(sessionStorage.getItem('curbnote-pending-walk')||'null');if(stored&&Date.now()-stored.at<3600000)pending=stored.walk;else sessionStorage.removeItem('curbnote-pending-walk');}catch{}
 async function api(path,body){const response=await fetch('/api/account/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw Error(data.error||'Could not connect. Please retry.');return data;}
 async function run(work){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await work();}catch(e){status(e.name==='NotAllowedError'?'Sign-in canceled or unavailable. You can keep walking without an account.':e.message);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 async function refresh(){const response=await api('session');account=response.account;$('auth').hidden=!!account;$('library').hidden=!account;$('save').hidden=!pending||!account;if(!account){status(pending?'Sign in, then choose Save walk to sync these addresses.':'Only walks you explicitly save are synced.');return;}
 $('account-label').textContent='Signed in as '+account.name;
 if(pending)$('pending-addresses').textContent=pending.origin.name+' → '+pending.destination.name+(pending.via?' · via '+pending.via.name:'');
 const result=await api('walks');$('walks').replaceChildren();
 if(!result.walks.length){const p=document.createElement('p');p.textContent='No saved walks yet. Plan a walk, then choose Save.';$('walks').append(p);}
 for(const walk of result.walks){const card=document.createElement('article');card.className='account-card';const heading=document.createElement('h3');heading.textContent=walk.name;const p=document.createElement('p');p.textContent=walk.origin.name+' → '+walk.destination.name;const open=document.createElement('button');open.textContent='Use these addresses';open.onclick=()=>{try{sessionStorage.setItem('curbnote-open-walk',JSON.stringify({at:Date.now(),walk}));location.href='/?savedWalk=1';}catch{status('Browser storage is unavailable. Allow site storage to open this walk.');}};const remove=document.createElement('button');remove.className='secondary';remove.textContent='Remove';remove.onclick=()=>run(async()=>{await api('walks/remove',{id:walk.id});await refresh();status('Saved walk removed.');});card.append(heading,p,open,remove);$('walks').append(card);}
 status('Your saved walks are ready.');}
 async function authenticate(kind){if(!window.PublicKeyCredential||!window.SimpleWebAuthnBrowser)throw Error('Passkeys are unavailable in this browser. Use a recent Safari, Chrome or Edge, or keep walking without an account.');
 const {flow,options}=await api('passkey/options',{kind,name:$('account-name').value||account?.name||'Curbnote walker'});
 const credential=kind==='login'?await SimpleWebAuthnBrowser.startAuthentication({optionsJSON:options}):await SimpleWebAuthnBrowser.startRegistration({optionsJSON:options});
 await api('passkey/verify',{flow,credential});await refresh();status(kind==='add'?'Additional passkey saved.':pending?'Signed in. Choose Save walk to sync these addresses.':'Signed in.');}
 for(const [id,kind] of [['register','register'],['login','login'],['reauth','login'],['add-passkey','add']])$(id).onclick=()=>run(()=>authenticate(kind));
 $('save-walk').onclick=()=>run(async()=>{if(!pending)return;await api('walks',{...pending,name:$('walk-name').value||'My walk',consent:true});sessionStorage.removeItem('curbnote-pending-walk');pending=null;await refresh();status('Walk saved across your devices.');});
 $('discard-pending').onclick=()=>{sessionStorage.removeItem('curbnote-pending-walk');pending=null;$('save').hidden=true;status('Walk was not synced.');};
 $('logout').onclick=()=>run(async()=>{await api('logout',{});await refresh();status('Signed out.');});
 $('delete-account').onclick=()=>{if(confirm('Delete your account and every synced walk? This cannot be undone.'))run(async()=>{await api('delete',{confirm:true});pending=null;sessionStorage.removeItem('curbnote-pending-walk');await refresh();status('Account and synced walks deleted.');});};
 run(refresh);
})();
