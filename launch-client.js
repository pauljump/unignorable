'use strict';
(()=>{
 const link=document.createElement('a');link.className='launch-feedback-link';link.href='/feedback';link.textContent='Feedback';document.body.append(link);
 const saved=document.createElement('a');saved.className='launch-feedback-link';saved.style.right='100px';saved.href='/account';saved.textContent='Saved walks';document.body.append(saved);
 const welcome=document.createElement('section');welcome.className='launch-welcome';welcome.setAttribute('aria-label','Welcome to Curbnote');welcome.innerHTML='<button class="dismiss" aria-label="Dismiss introduction">×</button><div class="curbnote-lockup"><img src="/assets/brand/curbnote-mark-v1.svg" width="44" height="44" alt=""><b>curbnote</b></div><small>NYC · FREE EARLY ACCESS</small><h1>Know your walk.<br>Improve your block.</h1><p>Choose what to walk around. See the dated evidence behind it. Help us learn what changed.</p><div class="launch-actions"><button id="launch-walk">Plan my walk</button><a href="/records">Explore block records</a></div><p style="font-size:12px;margin-bottom:0">Reported conditions are approximate, not live safety information.</p>';
 document.body.append(welcome);
 const dismiss=()=>{welcome.hidden=true;try{sessionStorage.setItem('unignorable-intro','seen');}catch{}};
 welcome.querySelector('.dismiss').addEventListener('click',dismiss);
 welcome.querySelector('#launch-walk').addEventListener('click',()=>{dismiss();document.getElementById('walk-open').click();});
 try{welcome.hidden=sessionStorage.getItem('unignorable-intro')==='seen'||location.search.length>0;}catch{welcome.hidden=location.search.length>0;}
 document.getElementById('walk-open').addEventListener('click',dismiss);
})();
