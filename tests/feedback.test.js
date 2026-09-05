const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createFeedbackStore,reviewPage}=require('../launch-feedback');
test('feedback remains private, survives reopen, supports replies, and rejects location dimensions',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unignorable-feedback-'));
 let store=createFeedbackStore(dir);
 try {
 const input={platform:'ios',category:'route',usefulness:'partly',message:'<img src=x onerror=alert(1)> I wanted a simpler turn.'};
 assert.throws(()=>store.submit({...input,lat:40.7}),/Choose a topic/);
 assert.throws(()=>store.submit({...input,message:'a'.repeat(2001)}),/Choose a topic/);
 assert.throws(()=>store.submit(null),/Choose a topic/);
 const receipt=store.submit(input);
 assert.deepEqual(Object.keys(store.receipt(receipt.id)).sort(),['id','reply','status']);
 assert.ok(!reviewPage(store.list()).includes('<img src=x'));
 assert.ok(store.update({id:receipt.id,status:'planned',reply:'We are improving the walking instructions.'}));
 store.close();store=createFeedbackStore(dir);
 assert.equal(store.receipt(receipt.id).reply,'We are improving the walking instructions.');
 assert.equal(store.receipt(receipt.id).status,'planned');
 assert.throws(()=>store.update({id:receipt.id,status:'public',reply:''}),/Invalid/);
 assert.equal(store.receipt('unknown'),undefined);
 } finally {store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
