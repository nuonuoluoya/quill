const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Favorites } = require('../core/favorites');
const { sha256 } = require('../utils/sha256');
const { favoriteId, reference, row } = require('../utils/favorites');
const deferred = () => { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve}; };
const fail = (code,status=409) => Object.assign(Error(code),{code,status});
const book = { bookId:'public-book',buildId:'build1',textRevision:'text1',visibility:'sample-public',title:'Synthetic book',contentType:'book',chapters:[{id:'c1',title:'First chapter'}] };
const sentences = Array.from({length:405},(_,i)=>({id:'s'+i,index:i+1,text:'Synthetic line '+i,audioId:'a'+i,duration:2,alignment:{status:'verified'}}));
const chapter = {...book,chapterId:'c1',sentences};
const ref = reference(book,chapter,sentences[0]), id = favoriteId(ref), date='2026-10-05T00:00:00.000Z';
function dto(index=0, overrides={}) { const r=reference(book,chapter,sentences[index]); return { favoriteId:favoriteId(r),favoritedAt:date,status:'available',reference:r,resolvedBuildId:'build1',sentence:sentences[index],source:{bookTitle:book.title,chapterTitle:'First chapter',contentType:'book',seasonTitle:null,episodeTitle:null,episodeNumber:null,part:null},playable:true,...overrides }; }
function setup(guest=true) {
  const data=new Map(), calls=[]; let owner={key:'guest:0',guest}, time=Date.parse(date), sequence=0;
  const p={scope:()=>owner,now:()=>time,uuid:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`,guestKey:'test:guest:favorites',
    storage:{get:k=>structuredClone(data.get(k)),set:(k,v)=>data.set(k,structuredClone(v))},content:{book:async()=>book,snapshot:async()=>book,chapter:async()=>chapter},
    api:async(...args)=>{calls.push(structuredClone(args)); throw fail('UNEXPECTED_REQUEST',500);} };
  const store=new Favorites(p);
  return {store,p,data,calls,owner:v=>owner=v,time:v=>time=v};
}
test('stable UTF8 SHA256 matches platform implementation, including block and unicode boundaries',()=>{
  for(const s of ['', 'abc','中文😀',...Array.from({length:140},(_,i)=>'x'.repeat(i))]) assert.equal(sha256(s),crypto.createHash('sha256').update(s).digest('hex'));
  assert.equal(id,crypto.createHash('sha256').update(JSON.stringify([book.bookId,book.textRevision,chapter.chapterId,'s0'])).digest('hex'));
});
test('guest restart, repeated add, remove/readd ordering and account switch preserve only local references',async()=>{
  const r=setup(); const first=await r.store.set(book,chapter,sentences[0],true);
  await r.store.set({...book,buildId:'build2'},chapter,sentences[0],true);
  assert.equal(r.store.guestData().version,1); assert.equal(r.store.guestData().items.length,1);
  assert.ok(!JSON.stringify([...r.data.values()]).includes('Synthetic'));
  const restarted=new Favorites(r.p); assert.equal((await restarted.list()).items[0].id,id);
  r.owner({key:'member:1',guest:false});r.p.api=async()=>({items:[],nextCursor:null,version:0,totalCount:0,matchedCount:0,playableCount:0});
  assert.equal((await r.store.list()).items.length,0); assert.equal(r.store.states.size,0);
  r.owner({key:'guest:2',guest:true});assert.equal((await r.store.list()).items[0].id,id);
  await r.store.remove({id});r.time(Date.parse(date)+1000); const added=await r.store.set(book,chapter,sentences[0],true);
  assert.notEqual(added.favoritedAt,first.favoritedAt);assert.equal(added.version,3);
});
test('guest storage failure and forbidden private reference never claim success',async()=>{
  const r=setup();r.p.storage.set=()=>{throw Error('disk full');};
  await assert.rejects(r.store.set(book,chapter,sentences[0],true),/disk full/);assert.equal(r.store.states.size,0);
  r.p.content.book=async()=>({...book,visibility:'private'});
  await assert.rejects(r.store.set(book,chapter,sentences[0],true),{code:'BOOK_FORBIDDEN'});assert.equal(r.data.size,0);
});
test('guest permissions precede text revision; redacted search never leaks titles or body; recovery restores same favorite',async()=>{
  const r=setup();await r.store.set(book,chapter,sentences[0],true);
  r.p.content.book=async()=>({...book,visibility:'private',textRevision:'new-text'});
  let list=await r.store.list();assert.equal(list.items[0].status,'forbidden');assert.equal(list.items[0].text,'');assert.equal(list.items[0].source,'');assert.equal(list.totalCount,1);assert.equal(list.playableCount,0);
  assert.equal((await r.store.list({query:'Synthetic'})).matchedCount,0);
  r.p.content.book=async()=>({...book,textRevision:'new-text'});assert.equal((await r.store.list()).items[0].status,'text_revision_changed');
  r.p.content.book=async()=>({...book,buildId:'audio2'});r.p.content.snapshot=r.p.content.book;
  assert.equal((await r.store.resolve({id})).book.buildId,'audio2');
  r.p.content.book=async()=>{throw fail('SERVICE_UNAVAILABLE',503);};await assert.rejects(r.store.list(),{code:'SERVICE_UNAVAILABLE'});
});
test('guest literal case-insensitive search, full statistics, keyset invalidation and audio-less favorites',async()=>{
  const r=setup(); for(let i=0;i<23;i++) await r.store.set(book,chapter,sentences[i],true);
  let list=await r.store.list();assert.equal(list.items.length,20);assert.equal(list.totalCount,23);assert.equal(list.playableCount,23);
  assert.equal((await r.store.list({cursor:list.nextCursor})).items.length,3);
  assert.equal((await r.store.list({query:' SYNTHETIC LINE 2 '})).matchedCount,4);
  assert.equal((await r.store.list({query:'%'})).matchedCount,0);
  await r.store.remove({id});await assert.rejects(r.store.list({cursor:list.nextCursor}),{code:'FAVORITES_CHANGED'});
  r.p.content.chapter=async()=>({...chapter,sentences:sentences.map(s=>({...s,audioId:null,duration:null,alignment:{status:'needs_review'}}))});
  list=await r.store.list();assert.equal(list.playableCount,0);assert.equal(list.items[0].locatable,true);assert.ok(list.items[0].text);
});
test('cloud status batches at 200, preserves unknown on failure and rejects mixed versions',async()=>{
  const r=setup(false);let count=0;
  r.p.api=async(path,method,body)=>{r.calls.push([path,method,body]);return {version:3,states:body.sentenceIds.map(sentenceId=>({sentenceId,favoriteId:favoriteId({...ref,sentenceId}),saved:sentenceId==='s0'}))};};
  assert.equal((await r.store.status(book,chapter)).length,405);assert.deepEqual(r.calls.map(c=>c[2].sentenceIds.length),[200,200,5]);assert.equal(r.store.states.get(id).saved,true);
  r.store.reset();r.p.api=async(path,method,body)=>({version:++count,states:body.sentenceIds.map(sentenceId=>({sentenceId,favoriteId:favoriteId({...ref,sentenceId}),saved:false}))});
  await assert.rejects(r.store.status(book,chapter),{code:'FAVORITES_CHANGED'});assert.equal(r.store.states.size,0);
});
test('uncertain cloud write retries identical UUID/time and accepts current truth, not old successful intent',async()=>{
  const r=setup(false);let n=0;
  r.p.api=async(...args)=>{r.calls.push(structuredClone(args));if(++n===1)throw fail('NETWORK_ERROR',0);return {favoriteId:id,saved:false,favoritedAt:null,version:7};};
  await assert.rejects(r.store.set(book,chapter,sentences[0],true),{code:'NETWORK_ERROR'});assert.equal(r.store.states.size,0);
  r.time(Date.parse(date)+10000);const result=await r.store.set(book,chapter,sentences[0],true);
  assert.deepEqual(r.calls[0],r.calls[1]);assert.equal(result.saved,false);assert.equal(r.store.states.get(id).saved,false);
  assert.equal(r.data.size,0);assert.equal(r.store.pending.size,0);
});
test('cloud write is single-flight and old version cannot overwrite newer confirmed state',async()=>{
  const r=setup(false), pending=deferred();let calls=0;r.p.api=()=>{calls++;return pending.promise;};
  const a=r.store.set(book,chapter,sentences[0],true),b=r.store.set(book,chapter,sentences[0],true);
  r.store.acceptVersion(9);r.store.states.set(id,{favoriteId:id,saved:false});
  pending.resolve({favoriteId:id,saved:true,favoritedAt:date,version:8});
  await assert.rejects(a,{code:'FAVORITES_CHANGED'});await assert.rejects(b,{code:'FAVORITES_CHANGED'});assert.equal(calls,1);assert.equal(r.store.states.get(id).saved,false);
});
test('expired mutation reads truth first; only a subsequent explicit action allocates new UUID',async()=>{
  const r=setup(false);let writes=0;
  r.p.api=async(path,method,body)=>{r.calls.push([path,method,body]);if(method==='PUT'){writes++;if(writes===1)throw fail('FAVORITE_MUTATION_EXPIRED');return {favoriteId:id,saved:true,favoritedAt:date,version:1};} throw fail('FAVORITE_NOT_FOUND',404);};
  await assert.rejects(r.store.set(book,chapter,sentences[0],true),{code:'FAVORITE_MUTATION_EXPIRED'});
  assert.equal(writes,1);assert.equal(r.calls[1][0],'/me/favorites/'+id);assert.equal(r.store.states.get(id).saved,false);
  await r.store.set(book,chapter,sentences[0],true);assert.equal(writes,2);assert.notEqual(r.calls[0][2].clientMutationId,r.calls[2][2].clientMutationId);
});
test('identity ABA rejects late cloud writes and private list without applying data',async()=>{
  for(const action of ['write','list']) {
    const r=setup(false),pending=deferred();r.p.api=()=>pending.promise;
    const work=action==='write'?r.store.set(book,chapter,sentences[0],true):r.store.list();
    r.owner({key:'guest:1',guest:true});r.store.capture();r.owner({key:'guest:2',guest:false});r.store.capture();
    pending.resolve(action==='write'?{favoriteId:id,saved:true,favoritedAt:date,version:1}:{items:[dto()],nextCursor:null,version:1,totalCount:1,matchedCount:1,playableCount:1});
    await assert.rejects(work,{code:'STALE_IDENTITY'});assert.equal(r.store.states.size,0);
  }
});
test('DTO rejects unavailable payload leaking fields and invalid same-reference IDs',()=>{
  assert.throws(()=>row(dto(0,{status:'forbidden',playable:false})));
  assert.throws(()=>row(dto(0,{favoriteId:'f'.repeat(64)})));
  const unavailable=row(dto(0,{status:'forbidden',playable:false,reference:null,resolvedBuildId:null,sentence:null,source:null}));
  assert.equal(unavailable.text,'');assert.equal(unavailable.locatable,false);assert.equal(unavailable.bookId,undefined);
});
test('10000 local references reject new adds but allow duplicates and removal',async()=>{
  const r=setup(); const items=Array.from({length:10000},(_,i)=>{const reference={...ref,sentenceId:'s'+i};return {favoriteId:favoriteId(reference),reference,sourceBuildId:'build1',favoritedAt:date,addedVersion:i+1};});
  r.data.set(r.p.guestKey,{schema:1,version:10000,items});
  const extra={...sentences[0],id:'extra'};r.p.content.chapter=async()=>({...chapter,sentences:[...sentences,extra]});
  await assert.rejects(r.store.set(book,chapter,extra,true),{code:'FAVORITES_LIMIT_REACHED'});
  assert.equal((await r.store.set(book,chapter,sentences[0],true)).version,10000);
  await r.store.remove({id});assert.equal(r.store.guestData().items.length,9999);
});
