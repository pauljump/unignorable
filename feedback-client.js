'use strict';
(async()=>{
  const form=document.getElementById('feedback-form'),receipt=document.getElementById('feedback-receipt');
  async function showReceipt(id){
    if(!/^[a-f0-9-]{36}$/.test(id))return;
    receipt.hidden=false;
    const link=document.getElementById('receipt-link');link.href='/feedback?receipt='+encodeURIComponent(id);
    const status=document.getElementById('receipt-status');status.textContent='Loading receipt…';
    try{const response=await fetch('/api/feedback/'+encodeURIComponent(id));const body=await response.json();if(!response.ok)throw new Error(body.error);status.textContent='Status: '+body.status;document.getElementById('receipt-reply').textContent=body.reply||'No reply yet. Thanks for helping shape Unignorable.';}catch(error){status.textContent=error.message||'Could not load receipt. Try again later.';}
  }
  if(form){
    const params=new URLSearchParams(location.search);let saved=null;try{saved=localStorage.getItem('unignorable-feedback-receipt');}catch{}
    const id=params.get('receipt')||saved;if(id)await showReceipt(id);
    if(params.get('topic')==='route')form.elements.category.value='route';
    form.addEventListener('submit',async event=>{
      event.preventDefault();const button=document.getElementById('feedback-send'),status=document.getElementById('feedback-status');button.disabled=true;status.textContent='Sending…';
      try{const response=await fetch('/api/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({platform:'web',category:form.elements.category.value,usefulness:form.elements.usefulness.value,message:form.elements.message.value})});const body=await response.json();if(!response.ok)throw new Error(body.error);try{localStorage.setItem('unignorable-feedback-receipt',body.id);}catch{}history.replaceState(null,'','/feedback?receipt='+body.id);status.textContent='Saved. Thank you.';form.elements.message.value='';await showReceipt(body.id);}catch(error){status.textContent=error.message||'Could not send. Your message is still here; try again.';}finally{button.disabled=false;}
    });
  }
  document.querySelectorAll('[data-review-id]').forEach(form=>form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('button'),status=form.querySelector('[role=status]');button.disabled=true;
    try{const response=await fetch('/api/feedback/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:form.dataset.reviewId,status:form.elements.status.value,reply:form.elements.reply.value})});if(!response.ok)throw new Error('Update failed. Check your review login.');status.textContent='Saved';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  }));
})();
