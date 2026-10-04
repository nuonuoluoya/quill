const { Player, initialPlayer } = require('../core/player');
const { sentenceAudio } = require('./sentence-audio');
const call = (api, name, args = {}) => new Promise((resolve, reject) => api[name]({ ...args, success: resolve, fail: reject }));
function recordingPorts(api, files) {
    return {
        async authorize(current = () => true) {
            const check = () => { if (!current()) throw { code: 'CANCELLED' }; };
            check();
            if (api.requirePrivacyAuthorize) { await call(api, 'requirePrivacyAuthorize'); check(); }
            const setting = await call(api, 'getSetting');
            check();
            if (setting.authSetting?.['scope.record'] === false) throw { code: 'DENIED' };
            try { await call(api, 'authorize', { scope: 'scope.record' }); }
            catch { check(); throw { code: 'DENIED' }; }
            check();
        },
        record(events) {
            const recorder = api.getRecorderManager(); let done = false;
            const finished = files?.begin() || (() => {});
            const bindings = {};
            const finish = (kind, value) => {
                if (done) return;
                done = true;
                for (const [name, fn] of Object.entries(bindings)) recorder['off' + name]?.(fn);
                if (kind === 'stop') files?.track(value?.tempFilePath);
                try { events[kind](value); } finally { finished(); }
            };
            bindings.Start = () => { if (!done) events.start(); };
            bindings.Stop = result => finish('stop', result);
            bindings.Error = () => finish('error');
            bindings.InterruptionBegin = () => { if (!done) events.interrupt(); };
            bindings.Pause = () => { if (!done) events.interrupt(); };
            bindings.Resume = () => { if (!done) { events.interrupt(); recorder.stop(); } };
            for (const [name, fn] of Object.entries(bindings)) recorder['on' + name]?.(fn);
            try { recorder.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'mp3' }); }
            catch { finish('error'); }
            return { stop() { if (!done) { try { recorder.stop(); } catch { finish('error'); } } } };
        },
        remove(path) { if (files) { void files.remove(path); return; } if (path) { try { api.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch {} } }
    };
}
function originalAudio(api, authorize, target, speed, events, files) {
    const state = initialPlayer(); let stopped = false, terminal = false, failure;
    const player = new Player(state, () => {
        const audio = api.createInnerAudioContext(); audio.obeyMuteSwitch = false;
        return sentenceAudio(api, audio, files);
    }, async (...args) => { try { return await authorize(...args); } catch (error) { failure = error; throw error; } });
    player.load(target.book, target.chapter, target.sentence.index - 1); player.setSpeed(speed);
    const timer = setInterval(() => {
        if (stopped || terminal) return;
        if (state.status === 'error') { terminal = true; events.error(failure); }
        else if (state.status === 'ended') { terminal = true; events.ended(); }
        else events.update(state.buffering ? 'buffering' : state.status, state.currentTime, state.duration);
    }, 100);
    void player.start();
    return { stop() { stopped = true; clearInterval(timer); player.dispose(); } };
}
function localAudio(api, path, events) {
    const audio = api.createInnerAudioContext(); let stopped = false, started = false, time = 0, changed = Date.now();
    audio.autoplay = false; audio.loop = false; audio.obeyMuteSwitch = false; audio.playbackRate = 1;
    const error = () => { if (!stopped) events.error(); };
    const timer = setInterval(() => { if (!stopped && Date.now() - changed > 15000) error(); }, 500);
    audio.onCanplay(() => { if (!stopped && !started) { started = true; audio.play(); } });
    audio.onPlay(() => { if (stopped) { audio.stop(); return; } changed = Date.now(); events.update('playing', audio.currentTime || 0, audio.duration || 0); });
    audio.onTimeUpdate(() => {
        if (stopped) return;
        if (audio.currentTime !== time) changed = Date.now(); time = audio.currentTime;
        events.update('playing', time || 0, audio.duration || 0);
    });
    audio.onWaiting?.(() => { if (!stopped) events.update('buffering', audio.currentTime || 0, audio.duration || 0); });
    audio.onPause(() => { if (!stopped) events.error(); });
    audio.onEnded(() => { if (!stopped) events.ended(); }); audio.onError(error);
    audio.src = path;
    return { stop() { if (stopped) return; stopped = true; clearInterval(timer); audio.stop(); audio.destroy(); } };
}
module.exports = { recordingPorts, originalAudio, localAudio };
