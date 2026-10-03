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
    const h = harness(t); h.engine.open(target()); await h.record('/old'); h.engine.rerecord(); assert.equal(h.auth, 1);
    await h.record('/short', 100); assert.equal(h.engine.recording.path, '/old'); assert.ok(h.removed.includes('/short')); assert.ok(!h.removed.includes('/old'));
    await h.engine.startRecording(); h.records.at(-1).events.error(); assert.equal(h.state.hasRecording, true); h.engine.play('mine'); assert.equal(h.sounds.at(-1).path, '/old');
});
test('one latest recording stays bound to its sentence and replaces old file only after success', async t => {
    const h = harness(t); h.engine.open(target()); await h.record('/one'); h.engine.close(); h.engine.open(target('s2'));
    assert.equal(h.state.hasRecording, false); h.engine.play('mine'); assert.equal(h.sounds.length, 0);
    h.engine.close(); h.engine.open(target()); assert.equal(h.state.hasRecording, true);
    await h.record('/two'); assert.deepEqual(h.removed, ['/one']); assert.equal(h.engine.recording.path, '/two');
});
test('comparison uses A then 500ms gap then B at 1x once; standalone original retains slow speed', async t => {
    const h = harness(t); h.engine.open(target()); await h.record(); h.engine.play('original'); assert.equal(h.sounds[0].speed, .75);
    h.engine.play('original', true); assert.equal(h.sounds[0].stopped, true); const a = h.sounds[1]; assert.equal(a.speed, 1);
    a.events.ended(); assert.equal(a.stopped, true); assert.equal(h.state.source, 'gap');
    t.mock.timers.tick(499); assert.equal(h.sounds.length, 2); t.mock.timers.tick(1); const b = h.sounds[2]; assert.equal(b.source, 'mine'); assert.equal(b.speed, 1);
    b.events.ended(); t.mock.timers.tick(1000); assert.equal(h.sounds.length, 3); assert.equal(h.state.status, 'recorded'); assert.equal(h.state.comparing, false);
});
test('stopping at A load, gap or B cancels every later stage and ignores late callbacks', async t => {
    const h = harness(t); h.engine.open(target()); await h.record();
    for (const stage of ['A', 'gap', 'B']) {
        h.engine.play('original', true); const a = h.sounds.at(-1);
        if (stage !== 'A') a.events.ended(); if (stage === 'B') t.mock.timers.tick(500);
        const last = h.sounds.at(-1), count = h.sounds.length; h.engine.stopPlayback(); a.events.ended(); last.events.update('playing', 2, 3); t.mock.timers.tick(1000);
        assert.equal(h.sounds.length, count); assert.equal(h.state.source, ''); assert.equal(h.state.comparing, false);
    }
});
test('late A progress, errors and duplicate end events cannot overwrite or restart B', async t => {
    const h = harness(t); h.engine.open(target()); await h.record(); h.engine.play('original', true);
    const a = h.sounds[0]; a.events.ended(); a.events.ended(); t.mock.timers.tick(500);
    assert.equal(h.sounds.length, 2); a.events.update('playing', 99, 100); a.events.error({ code: 'BOOK_FORBIDDEN' });
    assert.equal(h.state.source, 'mine'); assert.equal(h.state.currentTime, 0); assert.equal(h.state.reliable, true);
});
test('startup timeout stops capture and a synchronous stop callback cannot leave saving stuck', async t => {
    const h = harness(t); h.engine.open(target()); await h.engine.startRecording(); const r = h.records[0];
    r.stop = () => r.events.stop({}); t.mock.timers.tick(10000); assert.equal(h.engine.rec, null); assert.equal(h.state.status, 'ready');
});
test('A failure never starts B; lost original permission keeps my recording replayable', async t => {
    const h = harness(t); h.engine.open(target()); await h.record(); h.engine.play('original', true);
    h.sounds[0].events.error({ code: 'BOOK_FORBIDDEN' }); t.mock.timers.tick(1000); assert.equal(h.sounds.length, 1); assert.equal(h.state.reliable, false);
    h.engine.play('mine'); assert.equal(h.sounds.at(-1).source, 'mine');
});
test('unreliable original never requests microphone or launches comparison', async t => {
    const h = harness(t), item = target(); item.sentence.alignment.status = 'needs_review'; h.engine.open(item);
    await h.engine.startRecording(); h.engine.play('original', true); assert.equal(h.auth, 0); assert.equal(h.sounds.length, 0);
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
