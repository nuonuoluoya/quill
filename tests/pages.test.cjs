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
after(() => { player.dispose(); for (const r of [progressStore.get(book)])
    r.stop(); });
test('书架：会员分页去重且刷新失败保留书目', async () => { auth.session = { user: { id: 'test-member' } }; content.list = async () => ({ items: [{ ...book, chapterAudioAvailableCount: 0, contentChapterCount: 1 }], nextCursor: 'next' }); const p = page('library'); p.onLoad(); await tick(); assert.equal(p.data.books.length, 1); await p.load(false); assert.equal(p.data.books.length, 1); content.list = async () => { throw Error('请求失败'); }; await p.load(true); assert.equal(p.data.books.length, 1); assert.equal(p.data.error, '请求失败'); p.onUnload(); auth.session = null; });
test('目录：内容加载与继续阅读传递精确章节位置', async () => { content.book = async () => book; const p = page('book'); p.onLoad({ bookId: 'b' }); await tick(); assert.equal(p.data.chapters[0].number, '01'); p.continueReading(); assert.match(navigation.at(-1), /\/pages\/reader\/reader\?bookId=b&buildId=build&chapterId=c/); p.onUnload(); });
test('阅读：不自动播放，搜索保留索引，倍速/切章/后台生命周期', async () => { content.book = async () => book; content.chapter = async () => chapter; content.snapshot = async () => book; const p = page('reader'); p.onLoad({ bookId: 'b', chapterId: 'c' }); p.onShow(); await tick(); assert.equal(p.data.rows.length, 3); assert.equal(playerState.status, 'selected'); p.search({ detail: { value: 'LANTERN' } }); assert.equal(p.data.rows[0].index, 3); assert.equal(p.data.hiddenCurrent, true); p.locate(); await tick(); assert.equal(p.data.rows.length, 3); assert.equal(p.data.target, 'sentence-0'); p.click({ currentTarget: { dataset: { index: 2 } } }); assert.equal(playerState.index, 1); assert.equal(playerState.status, 'unavailable'); assert.equal(progressStore.get(book).state.progress.sentenceId, 's2'); p.onHide(); assert.equal(playerState.loop, false); p.onUnload(); });
test('阅读：页面卸载后迟到内容不会更新页面或启动播放器', async () => { let resolve; content.book = () => new Promise(r => resolve = r); content.chapter = async () => chapter; const p = page('reader'); p.onLoad({ bookId: 'b' }); p.onUnload(); resolve(book); await tick(); assert.equal(p.data.chapter, null); assert.equal(playerState.status, 'selected'); });
test('设置：同意隐私默认未勾选，未同意不请求登录，游客修改倍速独立存储', async () => { const p = page('settings'); selectedBook.value = null; p.onLoad(); p.onShow(); assert.equal(p.data.consent, false); await p.signIn(); assert.equal(auth.session, null); p.setSpeed({ currentTarget: { dataset: { value: 1.25 } } }); assert.equal(p.data.speed, 1.25); assert.equal(cache.get(`pidan:${require('../utils/http').environment}:guest:speed`), 1.25); p.onUnload(); });
test('旧公开样本目录和带版本正文链接均被拦截，不加载正文或启动播放', async () => {
    const sample = { ...book, visibility: 'sample-public', contentScope: 'sample' };
    content.book = async () => sample;
    const authModule = require('../models/auth'), originalApi = authModule.api;
    authModule.api = async () => sample;
    let chapterRequests = 0;
    content.chapter = async () => { chapterRequests++; return chapter; };
    try {
        for (const [name, query] of [['book', { bookId: 'b' }], ['reader', { bookId: 'b' }], ['reader', { bookId: 'b', buildId: 'build' }]]) {
            const p = page(name); p.onLoad(query); await tick();
            assert.match(p.data.error, /体验样本已下线/);
            assert.equal(p.data.book, null);
            p.onUnload();
        }
        assert.equal(chapterRequests, 0);
    } finally { authModule.api = originalApi; }
});
