const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { SyncRecord } = require('../core/sync');
const tick = () => new Promise(r => setImmediate(r));
function runtime(member = false, transportOverride) {
    const auth = { session: member ? {} : null, epoch: 1 }, selectedBook = { value: { bookId: 'b', buildId: 'build', textRevision: 'r', title: 'Real book title', contentType: 'book' } };
    const cache = new Map([['globalSpeed', 1.5], ['otherAccount', { dirty: true }]]), records = new Map(), resets = [], forgotten = [];
    let uid = 0, definition, clears = 0, disposed = 0, finishAudio, failSave = false;
    const identity = () => auth.session ? 'member' : 'guest';
    const transport = member ? transportOverride || { get: async () => ({ version: 1, progress: null }), reset: async (id, body) => {
        resets.push([id, structuredClone(body)]); return { version: body.expectedVersion + 1, progress: null };
    } } : null;
    const store = { get(b) { const key = [identity(), b.bookId, b.textRevision].join(':'); if (!records.has(key)) records.set(key,
        new SyncRecord(key, b.bookId, b.textRevision, { get: k => cache.get(k), set(k, v) { if (failSave) throw Error('full'); cache.set(k, structuredClone(v)); } }, transport, () => String(++uid)));
        return records.get(key); }, position: () => 'Chapter one', status: b => store.get(b).status, forgetRecent: id => forgotten.push(id) };
    const cleanupState = { busy: false, result: '' };
    const deps = {
        '../../models/auth': { auth, identity }, '../../models/context': { selectedBook },
        '../../models/preferences': { defaultSpeed: () => cache.get('globalSpeed') }, '../../models/content': {},
        '../../models/progress': { progressStore: store }, '../../models/player': { player: { dispose() { disposed++; } } },
        '../../utils/contracts': { speeds: [0.75, 1, 1.25, 1.5] }, '../../utils/events': { subscribe: () => () => {}, emit() {} },
        '../../utils/http': { message: e => e.message }, '../../utils/guest-preview': {},
        '../../models/audio-cleanup': { cleanupState, clearAudio: () => { clears++; cleanupState.busy = true;
            return new Promise(resolve => { finishAudio = () => { cleanupState.busy = false; cleanupState.result = '音频缓存已清除'; resolve(); }; }); } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/settings/settings.js'), 'utf8'), { require: key => deps[key], Page: p => { definition = p; } });
    const p = { ...definition, data: structuredClone(definition.data), setData(v) { Object.assign(this.data, v); } };
    p.onLoad(); p.onShow();
    const update = b => { const r = store.get(b); r.state.version = 1; r.update({ bookId: b.bookId, textRevision: b.textRevision, sourceBuildId: b.buildId,
        chapterId: 'c', sentenceId: 's', preferredSpeed: 0.75 }); return r; };
    return { p, auth, selectedBook, cache, store, update, resets, forgotten, cleanupState,
        get clears() { return clears; }, get disposed() { return disposed; }, finishAudio: () => finishAudio(), failSave: () => { failSave = true; } };
}
test('audio open/cancel does nothing; explicit confirmation is single flight and preserves every progress state', async () => {
    const r = runtime(), record = r.update(r.selectedBook.value), before = structuredClone(record.state);
    r.p.openAudio(); r.p.cancelConfirm(); assert.equal(r.clears, 0); assert.equal(r.disposed, 0);
    r.p.openAudio(); const work = r.p.confirmAction(); await r.p.confirmAction(); r.p.cancelConfirm();
    assert.equal(r.p.data.confirmKind, 'audio'); assert.equal(r.clears, 1);
    r.finishAudio(); await work; assert.equal(r.p.data.confirmKind, ''); assert.deepEqual(record.state, before);
    assert.equal(r.resets.length, 0); assert.equal(r.cache.get('globalSpeed'), 1.5);
});
test('guest reset is scoped to current content version and preserves global speed, other versions and accounts', async () => {
    const r = runtime(), b = r.selectedBook.value, record = r.update(b);
    const other = r.update({ ...b, textRevision: 'other-version' }), otherBefore = structuredClone(other.state);
    r.p.clear(); assert.equal(r.p.data.confirmTitle, b.title); assert.equal(r.p.data.confirmLoggedIn, false);
    r.p.cancelConfirm(); assert.ok(record.state.progress);
    r.p.clear(); await r.p.confirmAction(); assert.equal(record.state.progress, null); assert.equal(record.state.dirty, false);
    assert.deepEqual(other.state, otherBefore); assert.equal(r.cache.get('globalSpeed'), 1.5);
    assert.deepEqual(r.cache.get('otherAccount'), { dirty: true }); assert.equal(r.resets.length, 0);
    assert.match(r.p.data.resetResult, /游客进度已重置/); assert.equal(r.p.data.speed, 1.5);
});
test('member confirmation exposes pending work and sends one version-scoped idempotent reset', async () => {
    const r = runtime(true), b = r.selectedBook.value; r.update(b);
    r.p.clear(); assert.equal(r.p.data.confirmPending, true); assert.equal(r.p.data.confirmLoggedIn, true);
    r.p.cancelConfirm(); assert.equal(r.resets.length, 0);
    r.p.clear(); await r.p.confirmAction(); assert.equal(r.resets.length, 1);
    assert.deepEqual(r.resets[0], ['b', { textRevision: 'r', expectedVersion: 1, clientMutationId: '1' }]);
    assert.match(r.p.data.resetResult, /本机与云端进度已重置/);
});
test('pending work appearing after opening must display a warning before another confirmation', async () => {
    const r = runtime(true); r.p.clear(); assert.equal(r.p.data.confirmPending, false);
    r.update(r.selectedBook.value); await r.p.confirmAction(); assert.equal(r.resets.length, 0); assert.equal(r.p.data.confirmPending, true);
    await r.p.confirmAction(); assert.equal(r.resets.length, 1);
});
test('no selected content, changed identity, changed revision and leaving the page invalidate idle confirmation', async () => {
    for (const change of [r => { r.auth.epoch++; }, r => { r.selectedBook.value = { ...r.selectedBook.value, textRevision: 'new' }; }, r => r.p.onHide()]) {
        const r = runtime(true); r.update(r.selectedBook.value); r.p.clear(); change(r); await r.p.confirmAction();
        assert.equal(r.resets.length, 0); assert.equal(r.p.data.confirmKind, '');
    }
    const r = runtime(); r.selectedBook.value = null; r.p.clear(); assert.equal(r.p.data.confirmKind, ''); assert.match(r.p.data.error, /先选择/);
});
test('offline, conflict and local persistence failure never display completed reset', async () => {
    for (const error of [Error('offline'), { code: 'PROGRESS_CONFLICT', details: { version: 7, progress: null } }]) {
        const r = runtime(true, { reset: async () => { throw error; } }); r.update(r.selectedBook.value);
        r.p.clear(); await r.p.confirmAction(); assert.match(r.p.data.resetResult, /尚未完成/); assert.equal(r.forgotten.length, 0);
        const rec = r.store.get(r.selectedBook.value); assert.equal(rec.state.resetting, true);
    }
    const r = runtime(); r.update(r.selectedBook.value); r.failSave(); r.p.clear(); await r.p.confirmAction();
    assert.match(r.p.data.resetResult, /保存未完成/); assert.equal(r.forgotten.length, 0);
});
test('retry clears stale result, uses original mutation and a context change removes prior result', async () => {
    let offline = true; const requests = [];
    const r = runtime(true, { reset: async (_, body) => { requests.push(body); if (offline) throw Error('offline'); return { version: 2, progress: null }; } });
    r.update(r.selectedBook.value); r.p.clear(); await r.p.confirmAction(); assert.match(r.p.data.resetResult, /尚未完成/);
    offline = false; await r.p.sync(); assert.equal(r.p.data.resetResult, ''); assert.deepEqual(requests[0], requests[1]);
    assert.equal(r.store.get(r.selectedBook.value).state.resetting, false);
    r.p.clear(); await r.p.confirmAction(); r.selectedBook.value = null; r.p.refresh(); assert.equal(r.p.data.resetResult, '');
});
test('cancelled identity cannot reset or write after waiting for a previous sync job', async () => {
    let finish, writes = 0, resets = 0;
    const rec = new SyncRecord('isolated', 'b', 'r', { get() {}, set() { writes++; } }, {
        get: () => new Promise(resolve => { finish = resolve; }), reset: async () => { resets++; }
    }, () => 'mutation');
    const pending = rec.pull(), reset = rec.clear(); await tick(); rec.stop(); finish({ version: 1, progress: null });
    await Promise.all([pending, reset]); assert.equal(writes, 0); assert.equal(resets, 0); assert.equal(rec.state.resetting, undefined);
});
test('resolving a reset conflict refreshes its result instead of leaving a stale error', async () => {
    let conflict = true;
    const r = runtime(true, { reset: async () => { if (conflict) throw { code: 'PROGRESS_CONFLICT', details: { version: 3, progress: null } }; return { version: 4, progress: null }; } });
    const record = r.update(r.selectedBook.value); r.p.clear(); await r.p.confirmAction(); assert.match(r.p.data.resetResult, /冲突/);
    conflict = false; await record.choose('local'); r.p.refresh(); assert.match(r.p.data.resetResult, /本机与云端进度已重置/);
    r.update(r.selectedBook.value); r.p.refresh(); assert.equal(r.p.data.resetResult, '');
});
