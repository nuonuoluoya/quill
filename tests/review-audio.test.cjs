const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Player, initialPlayer } = require('../core/player');
const { playable } = require('../utils/contracts');
const cache = new Map();
global.wx = { getStorageSync: k => cache.get(k), setStorageSync: (k, v) => cache.set(k, structuredClone(v)),
    removeStorageSync: k => cache.delete(k), getStorageInfoSync: () => ({ keys: [...cache.keys()] }), nextTick: fn => fn() };
const authModule = require('../models/auth');
const { checkChapter, content } = require('../models/content');
const tick = () => new Promise(resolve => setImmediate(resolve));
const b = { bookId: 'review-fixture', buildId: 'new', textRevision: 'same-text', contentType: 'tv', contentScope: 'sample', title: 'Review Fixture',
    seasons: [{ id: 's1', title: '第一季', order: 1 }], chapters: [{ id: 'c', seasonId: 's1', episodeNumber: 1, title: 'Fixture', sentenceCount: 4, playableCount: 2 }] };
const c = { bookId: b.bookId, buildId: b.buildId, textRevision: b.textRevision, chapterId: 'c',
    chapterAudio: { status: 'unavailable', audioId: null, duration: null, reasons: ['No chapter audio'] },
    sentences: ['verified', 'needs_review', 'needs_review', 'excluded'].map((status, i) => ({ id: 's' + i, index: i + 1,
        text: ['A clear morning.', 'Please check this wording.', 'A sentence without audio.', 'Excluded material.'][i],
        audioId: i < 2 ? 'a' + i : null, duration: i < 2 ? 2 : null,
        alignment: { status, reasons: status === 'verified' ? [] : ['Check wording'] } })) };

test('review DTO accepts both available and missing audio, counts actual playable sentences and preserves review evidence', () => {
    const before = structuredClone(c); assert.equal(checkChapter(c, b), c); assert.deepEqual(c, before);
    assert.deepEqual(c.sentences.map(playable), [true, true, false, false]);
    const old = structuredClone(c); old.sentences[1].audioId = old.sentences[1].duration = null;
    const oldBook = { ...b, chapters: [{ ...b.chapters[0], playableCount: 1 }] };
    assert.equal(checkChapter(old, oldBook), old);
    assert.throws(() => checkChapter(c, oldBook), e => e.code === 'CONTENT_INVALID');
});
test('review audio rejects incomplete pairs, invalid durations or empty reasons', () => {
    const changes = [{ audioId: null }, { audioId: '' }, { audioId: ' ' }, { audioId: 12 }, { duration: null },
        { duration: 0 }, { duration: -1 }, { duration: Infinity }, { duration: NaN }, { duration: '2' },
        { alignment: { status: 'needs_review', reasons: [] } }];
    for (const change of changes) {
        const bad = structuredClone(c); Object.assign(bad.sentences[1], change);
        assert.throws(() => checkChapter(bad, b), e => e.code === 'CONTENT_INVALID');
    }
});
test('unmatched, excluded and unknown statuses remain unplayable even with audio fields', () => {
    for (const status of ['unmatched', 'excluded', 'unknown']) {
        const bad = structuredClone(c); bad.sentences[1].alignment.status = status;
        assert.equal(playable(bad.sentences[1]), false);
        assert.throws(() => checkChapter(bad, b), e => e.code === 'CONTENT_INVALID');
    }
});
function playerHarness(t) {
    const audios = [], requests = [];
    const player = new Player(initialPlayer(), () => {
        const a = { events: {}, currentTime: 0, playbackRate: 1, plays: 0, play() { this.plays++; this.events.Play(); },
            pause() { this.events.Pause?.(); }, stop() {}, destroy() {}, seek() {} };
        for (const n of ['Canplay', 'Play', 'Pause', 'Ended', 'Error', 'TimeUpdate', 'Seeked']) a['on' + n] = fn => a.events[n] = fn;
        audios.push(a); return a;
    }, async (book, id) => { requests.push(id); return { audioId: 'a', url: 'https://fixture.invalid/a.mp3', duration: 2,
        issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() }; });
    player.load(b, c); t.after(() => player.dispose()); return { player, audios, requests };
}
test('review audio supports clicking, previous/next and looping; missing review audio does not request playback', async t => {
    const { player: p, audios, requests } = playerHarness(t); assert.equal(requests.length, 0);
    p.clickSentence(1); await tick(); audios.at(-1).events.Canplay(); assert.equal(p.state.status, 'playing');
    p.navigate(-1); await tick(); audios.at(-1).events.Canplay(); assert.equal(p.state.index, 0);
    p.navigate(1); await tick(); audios.at(-1).events.Canplay(); assert.equal(p.state.index, 1);
    p.setLoop(true); audios.at(-1).events.Ended(); await tick(); assert.equal(p.state.index, 1);
    audios.at(-1).events.Canplay(); assert.equal(p.state.status, 'playing');
    const count = requests.length; p.navigate(1); await tick(); assert.equal(p.state.status, 'unavailable'); assert.equal(requests.length, count);
    assert.equal(c.sentences[1].alignment.status, 'needs_review');
});
test('continuous play enters review audio and stops at the next missing sentence without skipping text', async t => {
    const { player: p, audios, requests } = playerHarness(t); p.setContinuous(true); await p.start(); audios.at(-1).events.Canplay();
    audios.at(-1).events.Ended(); await tick(); assert.equal(p.state.index, 1); audios.at(-1).events.Canplay(); assert.equal(p.state.status, 'playing');
    audios.at(-1).events.Ended(); await tick(); assert.equal(p.state.index, 2); assert.equal(p.state.status, 'unavailable');
    assert.deepEqual(requests, ['s0', 's1']);
});
test('all content reads and a session renewal replay advertise review audio without replacing authentication', async t => {
    const requests = [], { auth } = authModule; let failOnce = false;
    t.after(() => { auth.session = null; content.clear(); delete wx.request; delete wx.login; });
    wx.login = o => o.success({ code: 'isolated-test-code' });
    wx.request = o => {
        requests.push(o); const url = new URL(o.url);
        if (failOnce) { failOnce = false; o.success({ statusCode: 401, data: { error: { code: 'SESSION_EXPIRED' } } }); return; }
        const value = url.pathname.endsWith('/auth/wechat') ? { user: { id: 'test-user' }, accessToken: 'new-test-token', expiresAt: '2099-01-01T00:00:00Z' }
            : url.pathname.endsWith('/chapters/c') ? c : /\/books$/.test(url.pathname) ? { items: [b], nextCursor: null } : b;
        o.success({ statusCode: 200, data: { data: value } });
    };
    await content.list('sample'); assert.equal(requests[0].header.Authorization, undefined);
    auth.session = { user: { id: 'test-user' }, accessToken: 'old-test-token' };
    await content.list('member'); await content.book(b.bookId); await content.snapshot(b); await content.chapter(b, 'c');
    failOnce = true; await content.book(b.bookId);
    for (const r of requests) assert.equal(r.header['X-Quill-Capabilities'], 'review-audio-v1');
    assert.equal(requests[1].header.Authorization, 'Bearer old-test-token');
    assert.equal(requests.at(-2).header.Authorization, undefined); assert.equal(requests.at(-1).header.Authorization, 'Bearer new-test-token');
    assert.ok(requests.some(r => r.url.endsWith('/builds/new'))); assert.ok(requests.some(r => r.url.endsWith('/builds/new/chapters/c')));
});
test('reader update from an old build restores the same review sentence and exposes newly available audio', async t => {
    const { player, playerState } = require('../models/player'), { progressStore } = require('../models/progress');
    const oldBook = { ...b, buildId: 'old', chapters: [{ ...b.chapters[0], playableCount: 1 }] };
    const oldChapter = structuredClone(c); oldChapter.buildId = 'old'; oldChapter.sentences[1].audioId = oldChapter.sentences[1].duration = null;
    const originalApi = authModule.api, originalBook = content.book, originalChapter = content.chapter;
    authModule.api = async () => oldBook; content.book = async () => b; content.chapter = async book => checkChapter(book.buildId === 'old' ? oldChapter : c, book);
    let definition; global.Page = p => { definition = p; };
    delete require.cache[require.resolve('../pages/reader/reader')]; require('../pages/reader/reader');
    const p = { ...definition, data: structuredClone(definition.data), setData(v) { Object.assign(this.data, v); } };
    t.after(() => { p.onUnload(); progressStore.get(b).stop(); player.dispose(); authModule.api = originalApi; content.book = originalBook; content.chapter = originalChapter; delete global.Page; });
    p.onLoad({ bookId: b.bookId, buildId: 'old', chapterId: 'c', sentenceId: 's1' }); await tick();
    assert.equal(playerState.index, 1); assert.equal(playerState.status, 'unavailable'); assert.equal(p.data.rows[1].available, false);
    await p.updateContent(); await tick();
    assert.equal(p.data.book.buildId, 'new'); assert.equal(p.data.book.textRevision, 'same-text'); assert.equal(p.data.chapter.chapterId, 'c');
    assert.equal(playerState.index, 1); assert.equal(playerState.status, 'selected'); assert.equal(p.data.rows[1].available, true);
    assert.equal(p.data.rows[1].alignment.status, 'needs_review'); assert.equal(p.data.rows[1].reason, 'Check wording');
    assert.equal(p.data.rows[2].available, false); assert.equal(progressStore.get(b).state.dirty, false);
});
