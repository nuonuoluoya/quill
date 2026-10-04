const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Player, initialPlayer } = require('../core/player');
const { sentenceAudio } = require('../utils/sentence-audio');

function load(file, dependencies, globals) {
    const exports = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
        exports, require(name) {
            assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
            return dependencies[name];
        }, ...globals
    }, { filename: file });
    return exports;
}

for (const support of ['global', 'legacy', 'global-failure', 'devtools', 'devtools-legacy', 'platform-error', 'global-throw']) {
    for (const mode of ['sentence', 'chapter']) {
        test(`${support}: ${mode} configures silent-mode playback without autoplay or background resume`, async t => {
            let app, download, globalOptions, interrupted, interruptionEnded;
            const natives = [], warnings = [];
            const simulator = support.startsWith('devtools');
            const wx = {
                onNetworkStatusChange() {},
                getNetworkType(o) { o.success({ networkType: 'wifi' }); },
                onAudioInterruptionBegin(fn) { interrupted = fn; },
                onAudioInterruptionEnd(fn) { interruptionEnded = fn; },
                getFileSystemManager: () => ({ unlink() {} }),
                downloadFile(o) { download = o; return { abort() {} }; },
                createInnerAudioContext() {
                    if (support !== 'legacy' && !simulator) assert.equal(globalOptions.obeyMuteSwitch, false);
                    const events = {};
                    const audio = {
                        autoplay: true, obeyMuteSwitch: true, playbackRate: 1, currentTime: 0,
                        plays: 0, pause() { events.Pause?.(); }, stop() {}, destroy() {}, seek() {},
                        play() { this.plays++; events.Play?.(); },
                        set src(value) { this.source = value; events.Canplay?.(); }
                    };
                    for (const name of ['Canplay', 'Play', 'Pause', 'Ended', 'TimeUpdate', 'Seeked', 'Waiting', 'Error'])
                        audio['on' + name] = fn => { events[name] = fn; };
                    natives.push(audio);
                    return audio;
                }
            };
            if (support === 'devtools-legacy') wx.getSystemInfoSync = () => ({ platform: 'devtools' });
            else wx.getDeviceInfo = () => {
                if (support === 'platform-error') throw Error('device info unavailable');
                return { platform: simulator ? 'devtools' : 'ios' };
            };
            if (support !== 'legacy') wx.setInnerAudioOption = options => {
                globalOptions = options;
                assert.equal(options.obeyMuteSwitch, false);
                assert.equal('mixWithOther' in options, false);
                assert.equal('speakerOn' in options, false);
                if (support === 'global-failure') options.fail({ errMsg: 'test failure' });
                if (support === 'global-throw') throw Error('native bridge failure');
            };
            const grant = { audioId: 'a', url: 'https://audio.invalid/test.mp3', duration: 5,
                issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() };
            const model = load('models/player.js', {
                '../utils/events': { observable: value => value },
                '../core/player': { Player, initialPlayer },
                './content': { content: { playback: async () => grant } },
                './auth': { onIdentityChange() {} },
                '../utils/sentence-audio': { sentenceAudio },
                '../utils/audio-files': { audioFiles: () => undefined }
            }, { wx });
            const { player, playerState } = model;
            t.after(() => player.dispose());
            load('app.js', {
                './models/player': model,
                './models/progress': { progressStore: { online: {}, resume() {}, flushAll() {} } }
            }, { wx, App: value => { app = value; }, console: { warn: value => warnings.push(value) } });
            app.onLaunch();
            app.onShow();
            const book = { bookId: 'b', buildId: 'v' };
            player.load(book, { chapterId: 'c', chapterAudio: { status: 'available', duration: 5 },
                sentences: [{ id: 's', audioId: 'a', duration: 5, alignment: { status: 'verified' } }] });
            assert.equal(natives.length, 0, 'app launch and content load must not create or play audio');
            assert.equal(warnings.length, ['global-failure', 'global-throw'].includes(support) ? 1 : 0);
            if (simulator || support === 'legacy') assert.equal(globalOptions, undefined, 'unsupported global API must not be called');
            assert.equal(typeof interrupted, 'function', 'audio policy failure must not interrupt app initialization');
            if (mode === 'sentence') await player.start();
            else { player.chapterPlay(); await new Promise(resolve => setImmediate(resolve)); }
            const audio = natives[0];
            assert.equal(audio.autoplay, false);
            assert.equal(audio.obeyMuteSwitch, false, 'both modes retain the legacy silent-mode setting');
            if (mode === 'sentence') {
                assert.equal(audio.plays, 0, 'download must finish before playback');
                download.success({ statusCode: 200, tempFilePath: 'wxfile://test.mp3' });
            }
            assert.equal(audio.plays, 1);
            assert.equal(playerState.status, 'playing');
            interrupted();
            interruptionEnded();
            assert.equal(playerState.status, 'paused');
            assert.equal(audio.plays, 1, 'interruption end must not resume playback');
            app.onHide();
            app.onShow();
            assert.equal(audio.plays, 1, 'foreground return must not resume playback');
        });
    }
}
