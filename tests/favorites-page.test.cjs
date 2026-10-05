const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {Player,initialPlayer}=require('../core/player');
const {FavoritePractice,referenceKey}=require('../core/favorite-practice');
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
const a={id:'a',favoriteId:'a',bookId:'A',chapterId:'c',sentenceId:'s',textRevision:'r',text:'Private A',source:'Book A',available:true,locatable:true};
const b={...a,id:'b',favoriteId:'b',bookId:'B',text:'Private B',source:'Book B'};
function runtime() {
 const auth={epoch:0},state=initialPlayer(),player=new Player(state,()=>{throw Error('No audio requested in view tests');},async()=>{}),identityCallbacks=[];
 let user='one',definition;const navigation=[],cleanupState={busy:false},shadowState={open:false};
 const deps={ '../../core/favorite-practice':{FavoritePractice,referenceKey}, '../../models/player':{player,playerState:state},
 '../../models/shadowing':{shadowState,shadowing:{reset(){shadowState.open=false;},resume(){},open(){shadowState.open=true;}}},
 '../../models/audio-cleanup':{cleanupState}, '../../models/auth':{auth,identity:()=>user,onIdentityChange:fn=>{identityCallbacks.push(fn);return ()=>{};}},
 '../../utils/events':{subscribe:()=>()=>{}},'../../utils/http':{message:e=>e.message,navigate:url=>navigation.push(url),toLibrary(){}}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync('pages/favorites/view.js','utf8'),{module,require:k=>deps[k],setInterval,clearInterval});
 let items=[a,b];const service={list:async()=>({items:items.map(i=>({...i})),total:items.length,playableCount:items.length,nextCursor:null}),remove:async()=>({saved:false}),
 resolve:async i=>{const book={bookId:i.bookId,buildId:'v',textRevision:'r'},sentence={id:'s',index:1,text:i.text,audioId:'a',duration:2,alignment:{status:'verified'}};return {book,chapter:{chapterId:'c',sentences:[sentence]},sentence};}};
 definition=module.exports.createFavoritesPage(service);const p={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};
 p.onLoad();p.onShow();return {p,service,state,player,navigation,shadowState,cleanupState,items:v=>items=v,identity(v){user=v;auth.epoch++;identityCallbacks.forEach(fn=>fn());}};
}
test('current truth saved=true never removes a row; failed save keeps row and playback; remove current clears selection',async t=>{
 const r=runtime();t.after(()=>r.p.onUnload());await tick();await r.p.practice.select(a,false);r.p.practice.queue=[a,b];r.p.refresh();
 r.service.remove=async()=>({saved:true});await r.p.favorite({detail:{id:'a'}});assert.equal(r.p.practice.current.id,'a');assert.equal(r.p.data.rows.length,2);
 r.service.remove=async()=>{throw Error('network');};await r.p.favorite({detail:{id:'a'}});assert.equal(r.p.practice.current.id,'a');assert.equal(r.p.data.rows.length,2);
 r.service.remove=async()=>({saved:false});r.items([b]);await r.p.favorite({detail:{id:'a'}});assert.equal(r.p.practice.current,null);assert.equal(r.p.data.rows.length,1);
});
test('version conflict discards stale pagination, loads once from beginning; search keeps queue snapshot',async t=>{
 const r=runtime();t.after(()=>r.p.onUnload());await tick();await r.p.practice.select(a,false);r.p.practice.queue=[a,b];let calls=0;
 r.service.list=async({cursor})=>{calls++;if(cursor)throw Object.assign(Error('changed'),{code:'FAVORITES_CHANGED'});return {items:[b],total:1,playableCount:1,nextCursor:null};};
 r.p.cursor='old';r.p.data.hasMore=true;await r.p.more();assert.equal(calls,2);assert.equal(r.p.items.length,1);
 await r.p.search({detail:{value:'Private B'}});await tick();assert.equal(r.p.practice.current.id,'a');assert.equal(r.p.practice.queue.length,2);
});
test('redaction removes text/source, stops matching playback and still permits cancellation',async t=>{
 const r=runtime();t.after(()=>r.p.onUnload());await tick();await r.p.practice.select(a,false);r.p.practice.queue=[a,b];
 const redacted={id:'a',favoriteId:'a',available:false,locatable:false,text:'',source:'',unavailableLabel:'内容访问权限已失效'};
 r.p.failed(Object.assign(Error('denied'),{code:'FAVORITE_UNAVAILABLE',favoriteItem:redacted}),a);
 assert.equal(r.p.practice.current,null);assert.equal(r.p.data.rows[0].text,'');assert.equal(r.p.data.rows[0].source,'');assert.equal(r.p.data.rows[0].saved,true);
 assert.ok(!JSON.stringify(r.p.data).includes('Private A'));
});
test('account ABA and hide-return ignore late delete receipts',async t=>{
 const r=runtime();t.after(()=>r.p.onUnload());await tick();const d=deferred();r.service.remove=()=>d.promise;
 r.p.practice.queue=[a,b];const work=r.p.favorite({detail:{id:'a'}});r.identity('two');assert.equal(r.p.practice.queue.length,0);r.identity('one');await tick();
 // Version changes within one identity are harmless; account epoch changes invalidate the old callback.
 d.resolve({saved:false});await work;assert.equal(r.p.items.length,2);
 const old=deferred();r.service.remove=()=>old.promise;const second=r.p.favorite({detail:{id:'a'}});r.p.onHide();r.p.onShow();await tick();old.resolve({saved:false});await second;assert.equal(r.p.items.length,2);
});
test('resolving the next source keeps the dock in place and disables its controls',async t=>{
 const r=runtime();t.after(()=>r.p.onUnload());await tick();await r.p.practice.select(a,false);r.p.practice.queue=[a,b];r.p.refresh();const previous=r.p.data.currentChapter;
 const target=await r.service.resolve(b),pending=deferred();r.service.resolve=()=>pending.promise;
 const work=r.p.practice.navigate(1,false);assert.equal(r.p.data.currentChapter,previous);assert.equal(r.p.data.selecting,true);
 pending.resolve(target);await work;assert.equal(r.p.data.selecting,false);assert.equal(r.p.practice.target.book.bookId,'B');
});
test('hidden page cannot navigate from a late source response; recording blocks favorite actions',async t=>{
 const r=runtime();t.after(()=>r.p.onUnload());await tick();const d=deferred();r.service.resolve=()=>d.promise;const work=r.p.source({detail:{id:'a'}});
 r.p.onHide();r.p.onShow();d.resolve({book:{bookId:'A',buildId:'v'},chapter:{chapterId:'c'},sentence:{id:'s'}});await work;assert.equal(r.navigation.length,0);
 await tick();r.shadowState.open=true;r.p.refresh();let deletes=0;r.service.remove=async()=>{deletes++;};await r.p.favorite({detail:{id:'a'}});assert.equal(deletes,0);
});
for (const action of ['play','next','previous']) {
 test(`favorites ${action} closes the open row before delayed resolution, stays closed on failure and never writes favorites`,async t=>{
  const r=runtime();t.after(()=>r.p.onUnload());await tick();
  await r.p.practice.select(action==='previous'?b:a,false);r.p.practice.queue=[a,b];r.p.refresh();
  let writes=0;r.service.remove=async()=>{writes++;return {saved:false};};
  const pending=deferred();r.service.resolve=()=>{assert.equal(r.p.data.openedId,'');return pending.promise;};
  r.p.reveal({detail:{id:action==='previous'?'b':'a',open:true}});
  const before=JSON.stringify(r.p.items),work=action==='play'?r.p.play({detail:{id:'b'}}):r.p.action({detail:{action}});
  assert.equal(r.p.data.openedId,'');assert.equal(r.p.practice.current.id,action==='previous'?'a':'b');assert.equal(r.p.data.selecting,true);
  pending.resolve(Promise.reject(Error('test resolution failed')));await work;assert.equal(r.p.data.openedId,'');assert.ok(r.p.data.error);assert.equal(JSON.stringify(r.p.items),before);assert.equal(writes,0);
 });
}
test('favorites invalid or disabled navigation keeps the open row and current selection',async t=>{
 const r=runtime();t.after(()=>r.p.onUnload());await tick();await r.p.practice.select(a,false);r.p.practice.queue=[a,b];r.p.refresh();r.p.reveal({detail:{id:'a',open:true}});
 r.p.action({detail:{action:'previous'}});assert.equal(r.p.data.openedId,'a');
 r.p.play({detail:{id:'missing'}});assert.equal(r.p.data.openedId,'a');
 r.shadowState.open=true;r.p.refresh();r.p.action({detail:{action:'next'}});r.p.play({detail:{id:'b'}});assert.equal(r.p.data.openedId,'a');assert.equal(r.p.practice.current.id,'a');
});
