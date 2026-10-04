const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AudioFiles } = require('../core/audio-files');
const { audioFiles, validTemporaryPath } = require('../utils/audio-files');
const { sentenceAudio } = require('../utils/sentence-audio');
const { recordingPorts } = require('../utils/shadowing-runtime');
const { Player, initialPlayer } = require('../core/player');
const { Shadowing, initialShadowing } = require('../core/shadowing');
const tick = () => new Promise(r => setImmediate(r));
function registry(paths = [], failed = new Set()) {
    let saved = { schema: 1, paths };
    const deleted = [];
    const ports = { load: () => structuredClone(saved), save: v => { saved = structuredClone(v); }, valid: validTemporaryPath,
        unlink: async p => { if (failed.has(p)) throw Error('permission'); deleted.push(p); } };
    return { files: new AudioFiles(ports), ports, deleted, get saved() { return saved; } };
}
const a = 'wxfile://tmp_a.mp3', b = 'http://tmp/b.mp3';
test('audio cleanup only touches its file index and owned files; every progress queue and preference remains intact', async () => {
    const retained = { session: { token: 'isolated' }, globalSpeed: 1.5,
        progress: { dirty: true, inflight: { kind: 'put', body: { clientMutationId: 'pending' } }, preferredSpeed: 0.75 },
        otherAccount: { progress: 12 }, otherVersion: { progress: 7 } };
    const storage = new Map(Object.entries(structuredClone(retained))), deleted = [];
    const api = { getStorageSync: k => storage.get(k), setStorageSync: (k, v) => storage.set(k, structuredClone(v)),
        getFileSystemManager: () => ({ unlink(o) { deleted.push(o.filePath); o.success(); } }) };
    const f = audioFiles(api); assert.equal(audioFiles(api), f);
    f.track(a); f.track(b); assert.equal(await f.clear(() => {}), 'success');
    assert.deepEqual(deleted, [a, b]);
    for (const [k, v] of Object.entries(retained)) assert.deepEqual(storage.get(k), v);
    assert.equal(storage.size, Object.keys(retained).length + 1);
    assert.equal(await f.clear(() => {}), 'empty');
});
test('partial and failed deletion retain references across restarts and can be retried', async () => {
    const failed = new Set([b]), r = registry([a, b], failed);
    assert.equal(await r.files.clear(() => {}), 'partial'); assert.deepEqual(r.saved.paths, [b]);
    const restarted = new AudioFiles(r.ports);
    assert.equal(await restarted.clear(() => {}), 'failed');
    failed.clear(); assert.equal(await restarted.clear(() => {}), 'success'); assert.deepEqual(r.saved.paths, []);
});
test('missing files are empty, permission failures are not successful cleanup', async () => {
    for (const error of [{ errno: 1300002 }, { errno: 1301112 }, { errMsg: 'unlink:fail no such file or directory' }, { errno: 1300001 }]) {
        let saved;
        const api = { getStorageSync: () => saved, setStorageSync: (_, v) => { saved = v; },
            getFileSystemManager: () => ({ unlink: o => o.fail(error) }) };
        const f = audioFiles(api); f.track(a);
        assert.equal(await f.clear(() => {}), error.errno === 1300001 ? 'failed' : 'empty');
        assert.equal(saved.paths.length, error.errno === 1300001 ? 1 : 0);
    }
});
test('untrusted manifests and unsafe paths never expand deletion to other files', async () => {
    for (const path of ['wxfile://usr/secret', 'https://api.example/a', 'http://tmp/../private', 'wxfile://tmp%2e%2e/private']) {
        assert.equal(validTemporaryPath(path), false);
        const r = registry([path]); assert.equal(await r.files.clear(() => {}), 'failed'); assert.deepEqual(r.deleted, []);
    }
    const r = registry(); r.files.track('unmanaged://audio'); assert.equal(await r.files.clear(() => {}), 'failed');
    const failSave = registry([a]); failSave.ports.save = () => { throw Error('full'); };
    assert.equal(await failSave.files.clear(() => {}), 'partial');
});
test('cleanup is single flight, waits for terminal callbacks, and does not sweep active files on timeout', async () => {
    const r = registry([a]), finish = r.files.begin(); let stops = 0;
    const one = r.files.clear(() => { stops++; }, 30), two = r.files.clear(() => { stops++; });
    assert.equal(one, two); assert.equal(await one, 'failed'); assert.equal(stops, 1); assert.deepEqual(r.deleted, []);
    finish(); assert.equal(await r.files.clear(() => {}), 'success');
    const failedStop = registry([a]); assert.equal(await failedStop.files.clear(() => { throw Error('stop failed'); }), 'failed');
    assert.deepEqual(failedStop.deleted, []);
});
test('late download after cleanup cancellation is removed without reaching the decoder', async () => {
    const r = registry(); let request, aborted = 0;
    const native = { src: '', stop() {}, destroy() {} };
    const sound = sentenceAudio({ downloadFile(o) { request = o; return { abort() { aborted++; } }; } }, native, r.files);
    sound.src = 'https://isolated.invalid/audio';
    const work = r.files.clear(() => sound.destroy()); await tick();
    assert.equal(aborted, 1); assert.equal(r.files.leases.size, 1);
    request.success({ statusCode: 200, tempFilePath: a });
    assert.equal(await work, 'success'); assert.equal(native.src, ''); assert.deepEqual(r.saved.paths, []);
});
test('cleanup drains recording stop and deletes its late temporary file', async () => {
    const r = registry(); let onStop, stopped = 0;
    const ports = recordingPorts({ getRecorderManager: () => ({ onStop: fn => { onStop = fn; }, start() {}, stop() { stopped++; } }) }, r.files);
    const recording = ports.record({ stop: result => ports.remove(result.tempFilePath), error() {} });
    const work = r.files.clear(() => recording.stop()); await tick(); assert.equal(stopped, 1);
    onStop({ tempFilePath: b }); assert.equal(await work, 'success'); assert.deepEqual(r.deleted, [b]);
});
test('cleanup locks reject new ordinary playback, shadowing, recording and manual replay', async () => {
    let calls = 0;
    const p = new Player(initialPlayer(), () => { calls++; }, async () => { calls++; });
    p.cleanupSuspended = true; await p.start(); assert.equal(calls, 0);
    const s = new Shadowing(initialShadowing(), { authorize: async () => { calls++; } }); s.cleanupSuspended = true;
    assert.equal(s.open({}), false); await s.startRecording(); s.play('original'); assert.equal(calls, 0);
});
