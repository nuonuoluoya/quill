const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recordingPorts, localAudio, originalAudio } = require('../utils/shadowing-runtime');
const tick = () => new Promise(r => setImmediate(r));
function recorder() {
    const callbacks = {}, removed = [];
    const manager = { starts: [], stops: 0, start(o) { this.starts.push(o); }, stop() { this.stops++; } };
    for (const name of ['Start', 'Stop', 'Error', 'InterruptionBegin', 'Pause', 'Resume']) {
        manager['on' + name] = fn => callbacks[name] = fn;
        manager['off' + name] = fn => { if (callbacks[name] === fn) removed.push(name); };
    }
    return { manager, callbacks, removed };
}
test('privacy and microphone are requested only by authorize; known denial never reprompts', async () => {
    const calls = [];
    const api = { requirePrivacyAuthorize(o) { calls.push('privacy'); o.success(); }, getSetting(o) { calls.push('setting'); o.success({ authSetting: { 'scope.record': false } }); }, authorize() { throw Error('must not reprompt'); } };
    const ports = recordingPorts(api); assert.equal(calls.length, 0);
    await assert.rejects(ports.authorize(), e => e.code === 'DENIED'); assert.deepEqual(calls, ['privacy', 'setting']);
});
test('recorder waits for SDK events; stops detach callbacks and stale events do not mutate a new capture', () => {
    const r = recorder(); let started = 0, stopped = 0, failed = 0;
    const ports = recordingPorts({ getRecorderManager: () => r.manager });
    const session = ports.record({ start() { started++; }, stop() { stopped++; }, error() { failed++; }, interrupt() {} });
    assert.equal(started, 0); assert.equal(r.manager.starts[0].duration, 60000); assert.equal(r.manager.starts[0].format, 'mp3');
    const oldStart = r.callbacks.Start, oldStop = r.callbacks.Stop;
    oldStart(); assert.equal(started, 1); session.stop(); assert.equal(r.manager.stops, 1);
    oldStop({ tempFilePath: '/tmp/audio', duration: 500, fileSize: 1 }); oldStart(); oldStop({});
    assert.equal(started, 1); assert.equal(stopped, 1); assert.equal(failed, 0); assert.equal(r.removed.length, 6);
});
function audioApi() {
    const audios = [], downloads = [], removed = [];
    const api = {
        createInnerAudioContext() {
            const events = {}, audio = { events, currentTime: 0, duration: 3, playbackRate: 1, src: '', plays: 0, stopped: false,
                play() { this.plays++; }, pause() { events.Pause?.(); }, stop() { this.stopped = true; }, destroy() { this.destroyed = true; }, seek() {} };
            for (const n of ['Canplay', 'Play', 'Pause', 'Ended', 'TimeUpdate', 'Seeked', 'Waiting', 'Error']) audio['on' + n] = cb => events[n] = cb;
            audios.push(audio); return audio;
        },
        downloadFile(o) { const task = { options: o, abort() { this.aborted = true; } }; downloads.push(task); return task; },
        getFileSystemManager: () => ({ unlink({ filePath }) { removed.push(filePath); } })
    };
    return { api, audios, downloads, removed };
}
test('local replay is 1x, starts once on canplay, and ignores callbacks after stop', t => {
    const h = audioApi(); const events = [];
    const handle = localAudio(h.api, '/recording', { update: (...v) => events.push(v), error: () => events.push('error'), ended: () => events.push('ended') });
    t.after(() => handle.stop()); const audio = h.audios[0];
    assert.equal(audio.playbackRate, 1); assert.equal(audio.obeyMuteSwitch, false); assert.equal(audio.plays, 0);
    audio.events.Canplay(); audio.events.Canplay(); assert.equal(audio.plays, 1);
    audio.events.Play(); const length = events.length; handle.stop(); audio.events.Ended(); audio.events.Error(); audio.events.Play();
    assert.equal(events.length, length); assert.equal(audio.destroyed, true);
});
test('original uses authorized sentence download; stop aborts download and cleans late file', async t => {
    const h = audioApi(); let requested;
    const sentence = { id: 's', index: 1, duration: 3, audioId: 'a', alignment: { status: 'verified' } };
    const target = { book: { bookId: 'b' }, chapter: { chapterId: 'c', sentences: [sentence] }, sentence };
    const handle = originalAudio(h.api, async (...args) => { requested = args; return { audioId: 'a', url: 'https://example.invalid/audio', duration: 3, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+60000).toISOString() }; }, target, .75,
        { update() {}, error() {}, ended() {} });
    t.after(() => handle.stop()); await tick(); assert.equal(requested[1], 's'); assert.equal(requested[2], 'sentence');
    assert.equal(h.audios[0].playbackRate, .75); handle.stop(); assert.equal(h.downloads[0].aborted, true);
    h.downloads[0].options.success({ statusCode: 200, tempFilePath: '/late-original' });
    assert.deepEqual(h.removed, ['/late-original']); assert.equal(h.audios[0].plays, 0);
});
