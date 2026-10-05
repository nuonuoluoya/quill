const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const cache = new Map();
const navigation = [];
global.wx = { getStorageSync: k => cache.get(k), setStorageSync: (k, v) => cache.set(k, structuredClone(v)), removeStorageSync: k => cache.delete(k), getStorageInfoSync: () => ({ keys: [...cache.keys()] }), navigateTo: o => navigation.push(o.url), reLaunch: o => navigation.push(o.url), nextTick: fn => Promise.resolve().then(fn), stopPullDownRefresh() { } };
let definition;
global.Page = p => definition = p;
function page(name) { const file = require.resolve(`../pages/${name}/${name}.js`); delete require.cache[file]; require(file); const p = { ...definition, data: structuredClone(definition.data), setData(d) { Object.assign(this.data, d); } }; return p; }
const { content } = require('../models/content');
const { player, playerState } = require('../models/player');
const { auth } = require('../models/auth');
const { progressStore } = require('../models/progress');
const { selectedBook } = require('../models/context');
const book = { bookId: 'b', buildId: 'build', textRevision: 'r', title: 'Book', chapters: [{ id: 'c', title: 'Chapter', sentenceCount: 3, playableCount: 2 }] };
const chapter = { ...book, chapterId: 'c', chapterAudio: { status: 'unavailable', audioId: null, duration: null, reasons: ['Missing'] }, sentences: [1, 2, 3].map(index => ({ id: 's' + index, index, text: index === 3 ? 'Finding lanterns' : 'A quiet morning', audioId: index === 2 ? null : 'a' + index, duration: index === 2 ? null : 3, alignment: { status: index === 2 ? 'needs_review' : 'verified', reasons: index === 2 ? ['Review'] : [] } })) };
const tick = () => new Promise(r => setImmediate(r));
test('reader scroll closes without reopening from stale touchend, coalesces scroll events and permits the next gesture',async t=>{
 content.book=async()=>book;content.chapter=async()=>chapter;content.snapshot=async()=>book;
 const p=page('reader');t.after(()=>p.onUnload());p.onLoad({bookId:'b'});await tick();
 p.manualScroll();p.revealFavorite({detail:{id:'s1',open:true}});p.scrollRows();const epoch=p.data.scrollEpoch;
 p.revealFavorite({detail:{id:'s1',open:true}});assert.equal(p.data.openedId,'');for(let i=0;i<30;i++)p.scrollRows();assert.equal(p.data.scrollEpoch,epoch);
 p.manualScroll();p.revealFavorite({detail:{id:'s2',open:true}});assert.equal(p.data.openedId,'s2');
});
test('reader row and actual dock actions close swipes before playback; failures, bounds and disabled controls preserve intent',async t=>{
    const { favorites }=require('../models/favorites'),{favoriteId,reference}=require('../utils/favorites');
    const original={status:favorites.status,set:favorites.set,authorize:player.authorize,update:progressStore.update};let favoritesWrites=0,progressWrites=0,rejectAudio;
    favorites.status=async()=>{for(const s of chapter.sentences){const id=favoriteId(reference(book,chapter,s));favorites.states.set(id,{favoriteId:id,saved:true});}};
    favorites.set=async()=>{favoritesWrites++;};progressStore.update=()=>{progressWrites++;};
    content.book=async()=>book;content.chapter=async()=>chapter;content.snapshot=async()=>book;
    const p=page('reader');p.onLoad({bookId:'b'});p.onShow();await tick();
    t.after(()=>{p.onUnload();favorites.status=original.status;favorites.set=original.set;player.authorize=original.authorize;progressStore.update=original.update;favorites.reset();delete global.Component;});
    player.authorize=()=>{assert.equal(p.data.openedId,'');return new Promise((_,reject)=>{rejectAudio=reject;});};
    const savedBefore=p.data.rows.map(r=>r.saved);p.revealFavorite({detail:{id:'s1',open:true}});p.playRow({detail:{id:'s3',index:3}});
    assert.equal(p.data.openedId,'');assert.equal(playerState.index,2);assert.equal(playerState.status,'loading');
    rejectAudio(Object.assign(Error('test audio unavailable'),{code:'SENTENCE_UNPLAYABLE'}));await tick();assert.equal(p.data.openedId,'');assert.equal(playerState.status,'error');
    let definition;global.Component=value=>definition=value;const file=require.resolve('../components/player-dock/player-dock');delete require.cache[file];require(file);
    const dock={...definition.methods,properties:{chapter,frozen:false}};
    p.revealFavorite({detail:{id:'s3',open:true}});dock.action({currentTarget:{dataset:{action:'previous'}}});assert.equal(p.data.openedId,'');assert.equal(playerState.index,1);
    p.revealFavorite({detail:{id:'s1',open:true}});dock.action({currentTarget:{dataset:{action:'next'}}});assert.equal(p.data.openedId,'');assert.equal(playerState.index,2);
    p.revealFavorite({detail:{id:'s1',open:true}});const writes=progressWrites;dock.action({currentTarget:{dataset:{action:'next'}}});assert.equal(p.data.openedId,'s1');assert.equal(progressWrites,writes);
    dock.properties.frozen=true;dock.action({currentTarget:{dataset:{action:'previous'}}});p.data.frozen=true;p.playRow({detail:{id:'s2',index:2}});assert.equal(p.data.openedId,'s1');assert.equal(playerState.index,2);
    assert.equal(favoritesWrites,0);assert.deepEqual(p.data.rows.map(r=>r.saved),savedBefore);
});
test('reader favorites acknowledge writes, failure keeps star, hidden reader cannot write favorite practice progress, return restores source', async t => {
    const { favorites } = require('../models/favorites'), { favoriteId, reference } = require('../utils/favorites');
    const { createFavoritesPage } = require('../pages/favorites/view');
    const originalStatus=favorites.status, originalSet=favorites.set, originalUpdate=progressStore.update;
    const refId=favoriteId(reference(book,chapter,chapter.sentences[0])); let fail=false, writes=[];
    favorites.status=async()=>{ for(const s of chapter.sentences) {const id=favoriteId(reference(book,chapter,s));if(!favorites.states.has(id))favorites.states.set(id,{favoriteId:id,saved:false});} };
    favorites.set=async(b,c,s,saved)=>{if(fail)throw Error('write failed');const result={favoriteId:refId,saved};favorites.states.set(refId,result);favorites.changed();return result;};
    progressStore.update=(b,p)=>writes.push([b.bookId,p.sentenceId]);
    content.book=async()=>book;content.chapter=async()=>chapter;content.snapshot=async()=>book;
    const p=page('reader'); let f;
    t.after(()=>{if(f)f.onUnload();p.onUnload();favorites.status=originalStatus;favorites.set=originalSet;progressStore.update=originalUpdate;favorites.reset();});
    p.onLoad({bookId:'b',sentenceId:'s3'});p.onShow();await tick();
    assert.equal(p.data.rows[0].saved,false);await p.changeFavorite({detail:{id:'s1'}});assert.equal(p.data.rows[0].saved,true);
    fail=true;await p.changeFavorite({detail:{id:'s1'}});assert.equal(p.data.rows[0].saved,true);assert.match(p.data.favoriteError,/write failed/);
    const source={...book,bookId:'favorite-source'},item={id:'f',bookId:source.bookId,textRevision:'r',chapterId:'c',sentenceId:'s1',available:true,locatable:true};
    const target={book:source,chapter:{...chapter,bookId:source.bookId},sentence:chapter.sentences[0]};
    const definition=createFavoritesPage({list:async()=>({items:[item],nextCursor:null,total:1,playableCount:1}),resolve:async()=>target});
    f={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};
    p.onHide();f.onLoad();f.onShow();await tick();await f.practice.select(item,false);player.select(2,false);await tick();assert.equal(writes.length,0);
    f.onHide();p.onShow();await tick();assert.equal(player.book.bookId,'b');assert.equal(playerState.index,2);assert.equal(player.onEnded,null);
    p.click({currentTarget:{dataset:{index:1}}});assert.ok(writes.length>0);assert.ok(writes.every(([bookId,sentenceId])=>bookId==='b'&&sentenceId==='s1'));
    const owned=player.onSelection;f.onUnload();assert.equal(player.onSelection,owned);f=null;
});
test('跟读面板保持打开，关闭后恢复循环偏好且不自动播放', async () => {
    content.book = async () => book; content.chapter = async () => chapter; content.snapshot = async () => book;
    const p = page('reader'); p.onLoad({ bookId: 'b', chapterId: 'c' }); p.onShow(); await tick();
    player.setLoop(true); const { shadowing, shadowState } = require('../models/shadowing');
    p.openShadowing(); await tick(); assert.equal(shadowState.open, true); assert.equal(player.suspended, true); assert.equal(playerState.loop, false);
    shadowing.close(); await tick(); assert.equal(player.suspended, false); assert.equal(playerState.loop, true); assert.notEqual(playerState.status, 'playing'); p.onUnload();
});
after(() => { player.dispose(); for (const r of [progressStore.get(book)])
    r.stop(); });
test('书架：会员分页去重且刷新失败保留书目', async () => { auth.session = { user: { id: 'test-member' } }; content.list = async () => ({ items: [{ ...book, chapterAudioAvailableCount: 0, contentChapterCount: 1 }], nextCursor: 'next' }); const p = page('library'); p.onLoad(); await tick(); assert.equal(p.data.books.length, 1); await p.load(false); assert.equal(p.data.books.length, 1); content.list = async () => { throw Error('请求失败'); }; await p.load(true); assert.equal(p.data.books.length, 1); assert.equal(p.data.error, '请求失败'); p.onUnload(); auth.session = null; });
test('目录：内容加载与继续阅读传递精确章节位置', async () => { content.book = async () => book; const p = page('book'); p.onLoad({ bookId: 'b' }); await tick(); assert.equal(p.data.chapters[0].number, '01'); p.continueReading(); assert.match(navigation.at(-1), /\/pages\/reader\/reader\?bookId=b&buildId=build&chapterId=c/); p.onUnload(); });
test('阅读：不自动播放，搜索保留索引，倍速/切章/后台生命周期', async () => { content.book = async () => book; content.chapter = async () => chapter; content.snapshot = async () => book; const p = page('reader'); p.onLoad({ bookId: 'b', chapterId: 'c' }); p.onShow(); await tick(); assert.equal(p.data.rows.length, 3); assert.equal(playerState.status, 'selected'); p.search({ detail: { value: 'LANTERN' } }); assert.equal(p.data.rows[0].index, 3); assert.equal(p.data.hiddenCurrent, true); p.locate(); await tick(); assert.equal(p.data.rows.length, 3); assert.equal(p.data.target, 'sentence-0'); p.click({ currentTarget: { dataset: { index: 2 } } }); assert.equal(playerState.index, 1); assert.equal(playerState.status, 'unavailable'); assert.equal(progressStore.get(book).state.progress.sentenceId, 's2'); p.onHide(); assert.equal(playerState.loop, false); p.onUnload(); });
test('阅读：页面卸载后迟到内容不会更新页面或启动播放器', async () => { let resolve; content.book = () => new Promise(r => resolve = r); content.chapter = async () => chapter; const p = page('reader'); p.onLoad({ bookId: 'b' }); p.onUnload(); resolve(book); await tick(); assert.equal(p.data.chapter, null); assert.equal(playerState.status, 'selected'); });
test('设置：同意隐私默认未勾选，未同意不请求登录，游客修改倍速独立存储', async () => { const p = page('settings'); selectedBook.value = null; p.onLoad(); p.onShow(); assert.equal(p.data.consent, false); await p.signIn(); assert.equal(auth.session, null); p.setSpeed({ currentTarget: { dataset: { value: 1.25 } } }); assert.equal(p.data.speed, 1.25); assert.equal(cache.get(`pidan:${require('../utils/http').environment}:guest:speed`), 1.25); p.onUnload(); });
test('公开内容目录和固定版本正文可供游客阅读，但不会自动登录或播放', async () => {
    const sample = { ...book, visibility: 'sample-public', contentScope: 'sample' };
    content.book = async () => sample;
    const authModule = require('../models/auth'), originalApi = authModule.api;
    authModule.api = async () => sample;
    let chapterRequests = 0;
    content.chapter = async () => { chapterRequests++; return chapter; };
    try {
        for (const [name, query] of [['book', { bookId: 'b' }], ['reader', { bookId: 'b' }], ['reader', { bookId: 'b', buildId: 'build' }]]) {
            const p = page(name); p.onLoad(query); await tick();
            assert.equal(p.data.error, '');
            assert.equal(p.data.book.bookId, sample.bookId);
            if (name === 'reader') assert.equal(p.data.rows.length, 3);
            assert.equal(auth.session, null);
            assert.notEqual(playerState.status, 'playing');
            p.onUnload();
        }
        assert.equal(chapterRequests, 2);
    } finally { authModule.api = originalApi; }
});
