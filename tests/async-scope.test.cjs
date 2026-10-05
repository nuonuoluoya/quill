const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { Shadowing, initialShadowing } = require('../core/shadowing');
const { recordingPorts } = require('../utils/shadowing-runtime');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const book = id => ({ bookId: id, buildId: 'v1', textRevision: 'r1', title: id, contentType: 'book', chapters: [{ id: 'c', title: 'Chapter', sentenceCount: 1 }] });
const sentence = { id: 's', index: 1, text: 'A sentence.', audioId: 'a', duration: 1, alignment: { status: 'verified', reasons: [] } };
const target = { owner: 'guest', book: book('A'), chapter: { chapterId: 'c' }, sentence };
function page(file, deps, globals = {}) {
    let definition;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
        require: key => { assert.ok(key in deps, key); return deps[key]; }, Page: p => { definition = p; },
        clearInterval, setInterval, ...globals
    });
    return { ...definition, data: structuredClone(definition.data), writes: 0,
        setData(value) { this.writes++; Object.assign(this.data, value); } };
}

for (const stage of ['privacy', 'setting', 'microphone']) {
    for (const cancel of ['stopRecording', 'close', 'interrupt', 'reset']) {
        test(`recording authorization stops after ${stage} when ${cancel} invalidates the attempt`, async () => {
            const pending = {}, calls = [];
            const api = Object.fromEntries([['requirePrivacyAuthorize', 'privacy'], ['getSetting', 'setting'], ['authorize', 'microphone']]
                .map(([method, name]) => [method, options => { calls.push(name); pending[name] = options; }]));
            const state = initialShadowing();
            const engine = new Shadowing(state, { ...recordingPorts(api), lock() {}, pauseOrdinary() {}, record() { calls.push('record'); } });
            engine.open(target); const work = engine.startRecording();
            if (stage !== 'privacy') { pending.privacy.success(); await tick(); }
            if (stage === 'microphone') { pending.setting.success({ authSetting: {} }); await tick(); }
            engine[cancel](); const before = [...calls];
            pending[stage].success(stage === 'setting' ? { authSetting: {} } : {});
            await tick(); assert.deepEqual(calls, before); await work; assert.equal(state.permissionDenied, false);
        });
    }
}
test('late permission failure cannot invalidate a new recording attempt', async t => {
    const settings = [], calls = [];
    const api = { requirePrivacyAuthorize: o => o.success(), getSetting: o => settings.push(o), authorize: o => { calls.push('microphone'); o.success(); } };
    const state = initialShadowing(); let events;
    const engine = new Shadowing(state, { ...recordingPorts(api), lock() {}, pauseOrdinary() {},
        record(e) { calls.push('record'); events = e; return { stop() { e.stop(null); } }; } });
    t.after(() => engine.reset()); engine.open(target);
    const old = engine.startRecording(); await tick(); engine.stopRecording();
    const current = engine.startRecording(); await tick();
    settings[1].success({ authSetting: {} }); await current;
    settings[0].fail({ errMsg: 'late failure' }); await old;
    assert.deepEqual(calls, ['microphone', 'record']); assert.ok(engine.rec); assert.equal(state.error, '');
    events.stop(null);
});

function readerRuntime() {
    const selectedBook = { value: null }, playerState = { index: 0, speed: 1, status: 'selected', mode: 'sentence' };
    let disposed = 0;
    const player = { dispose() { disposed++; playerState.status = 'selected'; }, load(b) { this.book = b; }, setForeground() {}, setSpeed() {} };
    const content = { book: async id => book(id), chapter: async b => ({ ...b, chapterId: 'c', sentences: [sentence] }), snapshot: async () => {} };
    const deps = {
        '../../models/content': { content }, '../../models/auth': { onIdentityChange: () => () => {} },
        '../../models/player': { player, playerState }, '../../models/context': { selectedBook },
        '../../models/preferences': { defaultSpeed: () => 1 },
        '../../models/progress': { progressStore: { get: () => ({ state: {} }), status: () => '', flushAll() {} } },
        '../../utils/contracts': require('../utils/contracts'), '../../utils/catalog': require('../utils/catalog'),
        '../../utils/podcast': require('../utils/podcast'), '../../utils/events': { subscribe: () => () => {} },
        '../../utils/http': { message: e => e.message }, '../../utils/guest-preview': {},
        '../../models/shadowing': { shadowing: { close() {}, reset() {}, interrupt() {}, resume() {} }, shadowState: {} },
        '../../models/audio-cleanup': { cleanupState: {} }, '../../models/favorites': { favorites: { states: new Map(), status: async () => [], revision: 0 } }, '../../utils/favorites': require('../utils/favorites')
    };
    return { content, player, playerState, selectedBook, get disposed() { return disposed; },
        create(id) { const p = page('pages/reader/reader.js', deps, { wx: { nextTick: fn => fn() } }); p.onLoad({ bookId: id }); return p; } };
}
test('unloaded reader update cannot stop the newly opened reader or write old page state', async () => {
    const r = readerRuntime(), a = r.create('A'); await tick(); const pending = deferred();
    r.content.book = () => pending.promise; const work = a.updateContent(); a.onUnload();
    r.content.book = async id => book(id); const b = r.create('B'); await tick();
    r.playerState.status = 'playing'; const disposed = r.disposed, writes = a.writes;
    pending.resolve(book('A')); await work;
    assert.equal(r.playerState.status, 'playing'); assert.equal(r.player.book.bookId, 'B');
    assert.equal(r.selectedBook.value.bookId, 'B'); assert.equal(r.disposed, disposed); assert.equal(a.writes, writes); b.onUnload();
});
test('reader hidden during initial load retries on return and never loads the hidden player',async()=>{
    const r=readerRuntime(),pending=deferred();r.content.book=()=>pending.promise;
    const p=r.create('A');p.onHide();pending.resolve(book('A'));await tick();assert.equal(p.data.chapter,null);
    r.content.book=async id=>book(id);p.onShow();await tick();assert.equal(p.data.chapter.chapterId,'c');assert.equal(p.data.busy,false);p.onUnload();
});
for (const change of ['identity-or-chapter', 'hide-and-return', 'newer-update']) {
    test(`reader update ignores stale lookup after ${change}`, async () => {
        const r = readerRuntime(), p = r.create('A'); await tick(); const pending = deferred();
        r.content.book = () => pending.promise; const old = p.updateContent();
        if (change === 'identity-or-chapter') p.epoch++;
        if (change === 'hide-and-return') { p.onHide(); p.onShow(); await tick(); }
        if (change === 'newer-update') { r.content.book = async () => book('A'); await p.updateContent(); }
        const disposed = r.disposed, writes = p.writes; r.playerState.status = 'playing';
        pending.resolve({ ...book('A'), textRevision: 'old-response' }); await old;
        assert.equal(r.disposed, disposed); assert.equal(p.writes, writes); assert.equal(r.playerState.status, 'playing'); p.onUnload();
    });
}
test('current reader update loads new revision and reports completion', async () => {
    const r = readerRuntime(), p = r.create('A'); await tick();
    r.content.book = async () => ({ ...book('A'), textRevision: 'r2' }); await p.updateContent();
    assert.equal(p.data.book.textRevision, 'r2'); assert.match(p.data.notice, /正文版本已更新/); assert.equal(p.data.busy, false); p.onUnload();
});
for (const stage of ['book', 'chapter']) {
    test(`reader update cancels its nested ${stage} load after hiding and returning`, async () => {
        const r = readerRuntime(), p = r.create('A'); await tick();
        const pending = deferred(), original = r.selectedBook.value; let lookups = 0, chapters = 0;
        r.content.book = async () => { lookups++; return stage === 'book' && lookups === 2 ? pending.promise : { ...book('A'), textRevision: 'r2' }; };
        r.content.chapter = async b => { chapters++; return stage === 'chapter' ? pending.promise : { ...b, chapterId: 'c', sentences: [sentence] }; };
        const work = p.updateContent(); await tick(); p.onHide(); p.active = true;
        pending.resolve(stage === 'book' ? book('A') : { chapterId: 'c', sentences: [sentence] }); await work;
        assert.equal(r.selectedBook.value, original); assert.equal(p.data.chapter, null); assert.equal(p.data.notice, '');
        assert.equal(p.data.busy, false); assert.match(p.data.error, /已取消.*重试/); assert.equal(chapters, stage === 'book' ? 0 : 1);
        r.content.book = async () => ({ ...book('A'), textRevision: 'r2' });
        r.content.chapter = async b => ({ ...b, chapterId: 'c', sentences: [sentence] });
        p.retry(); await tick(); assert.equal(p.data.book.textRevision, 'r2'); assert.equal(p.data.chapter.chapterId, 'c');
        assert.equal(p.data.error, ''); assert.equal(p.data.busy, false); assert.equal(r.playerState.status, 'selected'); p.onUnload();
    });
}

function settingsRuntime(stage) {
    const oldBook = book('A'), selectedBook = { value: oldBook }, auth = { session: null, epoch: 1 };
    const pending = deferred(), calls = { book: 0, pull: 0, confirm: 0, update: 0, redirect: 0 };
    const guest = { textRevision: 'r1', sentenceId: 's', preferredSpeed: 1 };
    const record = { state: { progress: guest }, pull: () => { calls.pull++; return stage === 'pull' && calls.pull === 1 ? pending.promise : Promise.resolve(); }, update: () => { calls.update++; } };
    const deps = {
        '../../models/auth': { auth, identity: () => auth.session ? 'member' : 'guest', login: async () => { auth.session = {}; auth.epoch++; selectedBook.value = null; } },
        '../../models/context': { selectedBook }, '../../models/preferences': { defaultSpeed: () => 1 },
        '../../models/content': { content: { book: async () => { calls.book++; return stage === 'book' ? pending.promise : book('A'); } } },
        '../../models/progress': { progressStore: { get: () => record, position: () => '', status: () => '' } },
        '../../models/player': { player: {} }, '../../utils/contracts': { speeds: [1] },
        '../../utils/events': { subscribe: () => () => {}, emit() {} },
        '../../utils/http': { confirm: () => { calls.confirm++; return stage === 'confirm' ? pending.promise : Promise.resolve(true); }, message: e => e.message, toLibrary() {} },
        '../../utils/guest-preview': { FULL_BOOK_ID: 'A' }, '../../models/audio-cleanup': { cleanupState: {} }
    };
    const p = page('pages/settings/settings.js', deps, { wx: { redirectTo: () => calls.redirect++ } });
    p.onLoad(); p.onShow(); p.data.consent = true;
    return { p, pending, auth, selectedBook, calls };
}
for (const stage of ['book', 'pull', 'confirm']) {
    for (const change of ['unload', 'hide-and-return', 'identity', 'content']) {
        test(`settings login ignores ${stage} response after ${change}`, async () => {
            const r = settingsRuntime(stage), work = r.p.signIn(); await tick();
            assert.equal(r.calls[stage], 1);
            if (change === 'unload') r.p.onUnload();
            if (change === 'hide-and-return') { r.p.onHide(); r.p.onShow(); }
            if (change === 'identity') r.auth.epoch++;
            if (change === 'content' || change === 'unload') r.selectedBook.value = book('B');
            const b = r.selectedBook.value;
            const calls = { ...r.calls }, writes = r.p.writes;
            r.pending.resolve(stage === 'book' ? book('A') : true); await work;
            assert.equal(r.selectedBook.value, b); assert.deepEqual(r.calls, calls);
            if (change === 'unload') assert.equal(r.p.writes, writes);
            else assert.equal(r.p.data.busy, false);
        });
    }
}
test('normal login restores guest book and merges only after explicit acceptance', async () => {
    const r = settingsRuntime('confirm'), work = r.p.signIn(); await tick();
    assert.equal(r.selectedBook.value.bookId, 'A'); assert.equal(r.calls.pull, 1); assert.equal(r.calls.update, 0);
    r.auth.session = { renewed: true }; // Same identity/epoch token renewal must not cancel the user's decision.
    r.pending.resolve(true); await work;
    assert.equal(r.calls.update, 1); assert.equal(r.calls.pull, 2); assert.equal(r.p.data.error, ''); assert.equal(r.p.data.busy, false);
});
test('declining guest merge does not update progress', async () => {
    const r = settingsRuntime('confirm'), work = r.p.signIn(); await tick(); r.pending.resolve(false); await work;
    assert.equal(r.calls.update, 0); assert.equal(r.calls.pull, 1);
});
test('locked chapter login does not navigate after identity changes during lookup', async () => {
    const r = settingsRuntime('book'); r.p.returnChapterId = 'c'; const work = r.p.signIn(); await tick();
    r.auth.epoch++; r.pending.resolve(book('A')); await work; assert.equal(r.calls.redirect, 0);
});
test('resuming a locked chapter cannot revive after hiding and returning', async () => {
    const r = settingsRuntime('book'); r.auth.session = {}; r.p.returnChapterId = 'c';
    const work = r.p.resumeRequested(); await tick(); r.p.onHide(); r.p.onShow();
    r.pending.resolve(book('A')); await work; assert.equal(r.calls.redirect, 0); assert.equal(r.p.data.busy, false);
});
test('only the latest requested chapter lookup may navigate', async () => {
    const r = settingsRuntime('book'); r.auth.session = {}; r.p.returnChapterId = 'c';
    const first = r.p.openRequestedChapter(), second = r.p.openRequestedChapter();
    r.pending.resolve(book('A')); await Promise.all([first, second]); assert.equal(r.calls.redirect, 1);
});
test('a hidden chapter lookup failure cannot leave a stale login error', async () => {
    const r = settingsRuntime('book'); r.auth.session = {}; r.p.returnChapterId = 'c';
    const work = r.p.resumeRequested(); await tick(); r.p.onHide(); r.p.onShow();
    r.pending.reject(Error('stale lookup')); await work; assert.equal(r.p.data.error, ''); assert.equal(r.p.data.busy, false);
});
