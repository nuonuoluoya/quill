const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Shadowing, initialShadowing } = require('../core/shadowing');
const { Player, initialPlayer } = require('../core/player');
const turn = () => Promise.resolve().then(() => Promise.resolve());
const target = (id = 's1') => {
    const sentence = { id, index: 1, text: 'Original test sentence.', duration: 3, audioId: 'a', alignment: { status: 'verified' } };
    return { owner: 'guest', speed: .75, book: { bookId: 'b', buildId: 'v', textRevision: 'r' }, chapter: { chapterId: 'c', sentences: [sentence] }, sentence };
};
function harness(t) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100000 });
    const state = initialShadowing(), records = [], sounds = [], removed = [], locks = [];
    let auth = 0, pause = 0;
    const ports = {
        now: () => Date.now(), authorize: async () => { auth++; }, pauseOrdinary() { pause++; }, lock: v => locks.push(v), remove: p => removed.push(p),
        record(events) { const r = { events, stops: 0, stop() { this.stops++; } }; records.push(r); return r; },
        original(target, speed, events) { const s = { source: 'original', target, speed, events, stopped: false, stop() { this.stopped = true; } }; sounds.push(s); return s; },
        mine(path, events) { const s = { source: 'mine', path, speed: 1, events, stopped: false, stop() { this.stopped = true; } }; sounds.push(s); return s; }
    };
    const engine = new Shadowing(state, ports); t.after(() => engine.reset());
    async function record(path = '/tmp/voice.mp3', duration = 1800) {
        await engine.startRecording(); const r = records.at(-1); r.events.start(); engine.stopRecording();
        r.events.stop({ tempFilePath: path, duration, fileSize: 1024 }); return r;
    }
    return { engine, state, ports, records, sounds, removed, locks, record, get auth() { return auth; }, get pauses() { return pause; } };
}
test('opening only pauses ordinary audio; recording clock starts on actual start event', async t => {
    const h = harness(t); h.engine.open(target()); assert.equal(h.auth, 0); assert.equal(h.records.length, 0); assert.equal(h.pauses, 1);
    await h.engine.startRecording(); t.mock.timers.tick(600); assert.equal(h.state.status, 'preparing'); assert.equal(h.state.elapsed, 0);
    h.records[0].events.start(); t.mock.timers.tick(1500); assert.equal(h.state.status, 'recording'); assert.ok(h.state.elapsed >= 1.5);
    h.engine.stopRecording(); assert.equal(h.state.status, 'saving'); assert.equal(h.state.hasRecording, false);
    h.records[0].events.stop({ tempFilePath: '/voice', duration: 1600, fileSize: 300 }); assert.equal(h.state.status, 'recorded');
});
test('denied permission leaves original audio usable and does not create a recorder', async t => {
    const h = harness(t); h.ports.authorize = async () => { throw { code: 'DENIED' }; }; h.engine.open(target());
    await h.engine.startRecording(); assert.equal(h.state.permissionDenied, true); assert.equal(h.records.length, 0);
    h.engine.play('original'); assert.equal(h.sounds[0].speed, .75);
});
test('cancel before permission resolves never starts recording; late denial cannot kill a newer attempt', async t => {
    const h = harness(t); let resolve, reject;
    h.ports.authorize = () => new Promise((yes, no) => { resolve = yes; reject = no; }); h.engine.open(target());
    const first = h.engine.startRecording(); h.engine.stopRecording(); resolve(); await first; assert.equal(h.records.length, 0);
    const old = h.engine.startRecording(); h.engine.close(); h.engine.open(target());
    h.ports.authorize = async () => {}; await h.engine.startRecording(); reject({ code: 'DENIED' }); await old;
    assert.equal(h.engine.rec.handle, h.records[0]);
});
test('cancelled pending start drains before new audio or recording; late start is stopped', async t => {
    const h = harness(t); h.engine.open(target()); await h.engine.startRecording(); const r = h.records[0];
    h.engine.stopRecording(); h.engine.play('original'); await h.engine.startRecording(); assert.equal(h.sounds.length, 0); assert.equal(h.records.length, 1);
    r.events.start(); assert.ok(r.stops >= 2); assert.notEqual(h.state.status, 'recording');
    r.events.stop({ tempFilePath: '/cancelled', duration: 500, fileSize: 20 }); assert.ok(h.removed.includes('/cancelled')); assert.equal(h.state.hasRecording, false);
});
test('re-record is opt-in; failure and too-short recording preserve the previous valid file', async t => {
    const h = harness(t); h.engine.open(target()); await h.record('/old'); assert.equal(h.auth, 1);
    await h.record('/short', 100); assert.equal(h.engine.recording.path, '/old'); assert.ok(h.removed.includes('/short')); assert.ok(!h.removed.includes('/old'));
    await h.engine.startRecording(); h.records.at(-1).events.error(); assert.equal(h.state.hasRecording, true); h.engine.play('mine'); assert.equal(h.sounds.at(-1).path, '/old');
});
test('one latest recording stays bound to its sentence and replaces old file only after success', async t => {
    const h = harness(t); h.engine.open(target()); await h.record('/one'); h.engine.close(); h.engine.open(target('s2'));
    assert.equal(h.state.hasRecording, false); h.engine.play('mine'); assert.equal(h.sounds.length, 0);
    h.engine.close(); h.engine.open(target()); assert.equal(h.state.hasRecording, true);
    await h.record('/two'); assert.deepEqual(h.removed, ['/one']); assert.equal(h.engine.recording.path, '/two');
});
test('re-record stops playback immediately and retains old file until a valid terminal result', async t => {
    const h = harness(t); h.engine.open(target()); await h.record('/old'); h.engine.play('mine');
    await h.engine.startRecording(); assert.equal(h.sounds[0].stopped, true);
    assert.equal(h.state.status, 'preparing'); assert.equal(h.engine.recording.path, '/old');
    const r = h.records.at(-1); r.events.start(); assert.equal(h.state.status, 'recording');
    h.engine.play('original'); h.engine.play('mine'); assert.equal(h.sounds.length, 1);
    h.engine.stopRecording(); assert.equal(h.state.status, 'saving'); assert.equal(h.engine.recording.path, '/old');
    assert.ok(!h.removed.includes('/old'));
    r.events.stop({ tempFilePath: '/new', duration: 1200, fileSize: 10 });
    assert.equal(h.engine.recording.path, '/new'); assert.deepEqual(h.removed, ['/old']);
    r.events.stop({ tempFilePath: '/new', duration: 1200, fileSize: 10 }); assert.deepEqual(h.removed, ['/old']);
});
test('cancelled and denied re-record permissions preserve the old recording and ignore late results', async t => {
    const h = harness(t); h.engine.open(target()); await h.record('/old');
    let resolve; h.ports.authorize = () => new Promise(yes => { resolve = yes; });
    const pending = h.engine.startRecording(); h.engine.stopRecording(); resolve(); await pending;
    assert.equal(h.records.length, 1); assert.equal(h.state.status, 'recorded');
    h.ports.authorize = async () => { throw { code: 'DENIED' }; }; await h.engine.startRecording();
    assert.equal(h.state.status, 'recorded'); assert.equal(h.engine.recording.path, '/old'); assert.equal(h.removed.length, 0);
    h.engine.play('mine'); assert.equal(h.sounds.at(-1).path, '/old');
});
test('synchronous audio completion cannot leave a live source or restart later', async t => {
    const h = harness(t); h.engine.open(target()); await h.record(); let stops = 0;
    h.ports.mine = (path, events) => { events.ended(); return { stop() { stops++; } }; };
    h.engine.play('mine'); assert.equal(stops, 1); assert.equal(h.engine.sound, null);
    assert.equal(h.state.status, 'recorded'); t.mock.timers.tick(1000); assert.equal(h.state.source, '');
});
test('manual switching stops the old source first and endings never start another source', async t => {
    const h = harness(t); h.engine.open(target()); await h.record();
    for (const source of ['original', 'mine', 'original', 'mine']) {
        const previous = h.sounds.at(-1);
        const factory = h.ports[source];
        h.ports[source] = (...args) => { if (previous) assert.equal(previous.stopped, true); return factory(...args); };
        h.engine.play(source); h.ports[source] = factory;
        const current = h.sounds.at(-1); assert.equal(current.speed, source === 'original' ? .75 : 1);
        assert.equal(h.sounds.filter(s => !s.stopped).length, 1);
    }
    const last = h.sounds.at(-1); last.events.ended(); last.events.ended();
    t.mock.timers.tick(60000); assert.equal(h.sounds.length, 4); assert.equal(h.state.status, 'recorded'); assert.equal(last.stopped, true);
});
test('manual stop at load, play or buffering ignores callbacks; re-listening starts from zero', async t => {
    const h = harness(t); h.engine.open(target()); await h.record();
    for (const source of ['original', 'mine']) for (const stage of ['loading', 'playing', 'buffering']) {
        h.engine.play(source); const sound = h.sounds.at(-1); sound.events.update(stage, 1, 3);
        const count = h.sounds.length; h.engine.play(source); assert.equal(sound.stopped, true);
        sound.events.ended(); sound.events.update('playing', 2, 3); sound.events.error(); t.mock.timers.tick(1000);
        assert.equal(h.sounds.length, count); assert.equal(h.state.source, ''); assert.equal(h.state.error, '');
        h.engine.play(source); assert.equal(h.state.currentTime, 0); assert.notEqual(h.sounds.at(-1), sound); h.engine.stopPlayback();
    }
});
test('rapid original-mine-original switching rejects every stale callback including the same source', async t => {
    const h = harness(t); h.engine.open(target()); await h.record();
    h.engine.play('original'); h.engine.play('mine'); h.engine.play('original');
    for (const old of h.sounds.slice(0, -1)) { old.events.update('playing', 99, 100); old.events.error({ code: 'BOOK_FORBIDDEN' }); old.events.ended(); }
    t.mock.timers.tick(1000); assert.equal(h.sounds.length, 3); assert.equal(h.state.source, 'original'); assert.equal(h.state.currentTime, 0); assert.equal(h.state.reliable, true);
});
test('startup timeout stops capture and a synchronous stop callback cannot leave saving stuck', async t => {
    const h = harness(t); h.engine.open(target()); await h.engine.startRecording(); const r = h.records[0];
    r.stop = () => r.events.stop({}); t.mock.timers.tick(10000); assert.equal(h.engine.rec, null); assert.equal(h.state.status, 'ready');
});
test('original failure never starts my recording; lost permission keeps my recording replayable', async t => {
    const h = harness(t); h.engine.open(target()); await h.record(); h.engine.play('original');
    h.sounds[0].events.error({ code: 'BOOK_FORBIDDEN' }); t.mock.timers.tick(1000); assert.equal(h.sounds.length, 1); assert.equal(h.state.reliable, false);
    h.engine.play('mine'); assert.equal(h.sounds.at(-1).source, 'mine');
});
test('review sentence without audio never requests microphone or plays original', async t => {
    const h = harness(t), item = target(); item.sentence.alignment.status = 'needs_review'; item.sentence.audioId = null; item.sentence.duration = null; h.engine.open(item);
    await h.engine.startRecording(); h.engine.play('original'); assert.equal(h.auth, 0); assert.equal(h.sounds.length, 0);
});

test('review sentence with audio permits manual original and recording without promoting its review status', async t => {
    const h = harness(t), item = target(); item.sentence.alignment = { status: 'needs_review', reasons: ['Check wording'] }; h.engine.open(item);
    assert.equal(h.sounds.length, 0); assert.equal(h.auth, 0); assert.equal(h.state.reliable, true);
    h.engine.play('original'); assert.equal(h.sounds[0].source, 'original');
    await h.engine.startRecording(); assert.equal(h.sounds[0].stopped, true); assert.equal(h.auth, 1); assert.equal(h.records.length, 1);
    assert.deepEqual(item.sentence.alignment, { status: 'needs_review', reasons: ['Check wording'] });
});
test('close keeps a valid pending result; interruption keeps valid fragment without automatic resume', async t => {
    const h = harness(t); h.engine.open(target()); await h.engine.startRecording(); const r = h.records[0]; r.events.start(); h.engine.close();
    r.events.stop({ tempFilePath: '/closed', duration: 900, fileSize: 90 }); h.engine.open(target()); assert.equal(h.state.hasRecording, true);
    await h.engine.startRecording(); const r2 = h.records[1]; r2.events.start(); h.engine.interrupt(); r2.events.stop({ tempFilePath: '/interrupted', duration: 700, fileSize: 90 });
    assert.match(h.state.error, /中断/); h.engine.resume(); assert.equal(h.state.status, 'recorded'); assert.equal(h.sounds.length, 0);
});
test('exit/account reset removes recording and rejects pending and duplicate late files', async t => {
    const h = harness(t); h.engine.open(target()); await h.record('/old'); await h.engine.startRecording(); const r = h.records.at(-1); r.events.start();
    h.engine.reset(); r.events.stop({ tempFilePath: '/late', duration: 900, fileSize: 90 }); assert.equal(h.engine.recording, null);
    assert.ok(h.removed.includes('/old')); assert.ok(h.removed.includes('/late')); assert.equal(h.locks.at(-1), false);
});
test('ordinary Player cannot start while shadowing owns sound', async () => {
    let grants = 0; const p = new Player(initialPlayer(), () => { throw Error('must not create audio'); }, async () => { grants++; });
    const item = target(); p.load(item.book, item.chapter); p.suspended = true; await p.start(); assert.equal(grants, 0); p.dispose();
});
