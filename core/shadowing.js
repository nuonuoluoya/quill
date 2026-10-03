const { playable } = require('../utils/contracts');
const initialShadowing = () => ({ open: false, status: 'ready', text: '', number: 0, reliable: false,
    hasRecording: false, duration: 0, elapsed: 0, error: '', permissionDenied: false,
    comparing: false, source: '', sourceStatus: '', currentTime: 0, sourceDuration: 0, originalDone: false });
const targetKey = t => JSON.stringify([t.owner, t.book.bookId, t.book.buildId, t.book.textRevision, t.chapter.chapterId, t.sentence.id]);

// Platform-neutral owner of one temporary recording and one active sound source.
class Shadowing {
    constructor(state, ports) {
        this.state = state; this.ports = ports; this.op = 0; this.session = 0; this.foreground = true;
    }
    publish(value) { Object.assign(this.state, value); this.ports.changed?.(); }
    lock() { this.ports.lock(this.state.open || !!this.rec); }
    matching() { return this.recording && this.target && this.recording.key === targetKey(this.target); }
    idle() { return this.matching() && !this.redo ? 'recorded' : 'ready'; }
    refreshRecording() {
        this.publish({ hasRecording: !!this.matching(), duration: this.matching() ? this.recording.duration : 0 });
    }
    open(target) {
        if (this.rec || this.cleanupSuspended) return false;
        this.stopPlayback(); this.target = target; this.redo = false; this.foreground = true;
        this.ports.pauseOrdinary();
        this.publish({ ...initialShadowing(), open: true, text: target.sentence.text, number: target.sentence.index,
            reliable: playable(target.sentence) });
        this.refreshRecording(); this.publish({ status: this.idle() }); this.lock(); return true;
    }
    stopPlayback() {
        this.op++; clearTimeout(this.gap); this.gap = null;
        const sound = this.sound; this.sound = null; sound?.stop();
        this.publish({ comparing: false, source: '', sourceStatus: '', currentTime: 0, sourceDuration: 0, status: this.idle() });
    }
    close() {
        this.stopPlayback(); this.stopRecording(); this.publish({ open: false }); this.lock();
    }
    reset() {
        this.session++; this.ports.forgetPreferences?.(); this.close();
        if (this.recording) this.ports.remove(this.recording.path);
        this.recording = null; this.target = null; this.redo = false; this.refreshRecording();
    }
    interrupt() {
        this.foreground = false;
        const recording = this.rec, active = recording || this.state.status === 'preparing';
        const playing = !!this.sound || !!this.gap;
        this.stopPlayback(); this.stopRecording(true);
        if (active || playing) this.publish({ error: active ? '录音已中断' : '播放已停止' });
    }
    resume() { this.foreground = true; }
    async startRecording() {
        if (this.cleanupSuspended || !this.state.open || !this.foreground || !this.state.reliable || this.rec || this.state.status === 'preparing') return;
        this.stopPlayback(); const op = this.op, session = this.session, target = this.target;
        let attempt;
        this.publish({ status: 'preparing', error: '', permissionDenied: false, elapsed: 0 });
        try {
            await this.ports.authorize();
            if (op !== this.op || !this.state.open || !this.foreground) return;
            const rec = { session, key: targetKey(target), started: false, keep: true, interrupted: false };
            this.rec = rec; attempt = rec; this.lock();
            // Keep ownership until a terminal recorder callback; cancelled starts must drain.
            rec.timer = setTimeout(() => {
                if (this.rec !== rec) return;
                rec.keep = false; rec.cancelled = true;
                this.publish({ status: 'saving', error: '录音未开始，请重试；正在停止录音设备' });
                rec.handle?.stop();
            }, 10000);
            rec.handle = this.ports.record({
                start: () => {
                    if (this.rec !== rec) return;
                    clearTimeout(rec.timer);
                    if (rec.cancelled || rec.session !== this.session || !this.foreground || !this.state.open) {
                        rec.keep = false; rec.handle?.stop(); return;
                    }
                    rec.started = true; rec.began = this.ports.now();
                    this.publish({ status: 'recording', elapsed: 0 });
                    rec.clock = setInterval(() => {
                        if (this.rec === rec) this.publish({ elapsed: Math.max(0, (this.ports.now() - rec.began) / 1000) });
                    }, 100);
                },
                stop: result => this.recordStopped(rec, result),
                error: () => this.recordStopped(rec, null),
                interrupt: () => this.interrupt()
            });
            if (rec.cancelled) rec.handle.stop();
        } catch (error) {
            if (attempt && this.rec === attempt) this.recordStopped(attempt, null);
            if (op === this.op && this.state.open) this.publish({ status: this.idle(),
                error: error?.code === 'DENIED' ? '未开启麦克风，仍可听原音' : '录音未开始，请重试',
                permissionDenied: error?.code === 'DENIED' });
        }
    }
    stopRecording(interrupted = false) {
        if (!this.rec) {
            if (this.state.status === 'preparing') { this.op++; this.publish({ status: this.idle() }); }
            return;
        }
        const rec = this.rec;
        clearTimeout(rec.timer); clearInterval(rec.clock);
        rec.interrupted ||= interrupted; rec.cancelled = true;
        if (!rec.started) rec.keep = false;
        this.publish({ status: 'saving' }); rec.handle?.stop();
    }
    recordStopped(rec, result) {
        const path = result?.tempFilePath;
        if (this.rec !== rec) { if (path && path !== this.recording?.path) this.ports.remove(path); return; }
        clearTimeout(rec.timer); clearInterval(rec.clock); this.rec = null;
        const valid = rec.keep && rec.started && rec.session === this.session && path &&
            Number.isFinite(result.duration) && result.duration >= 300 && result.fileSize > 0;
        if (valid) {
            const old = this.recording;
            this.recording = { key: rec.key, path, duration: result.duration / 1000 };
            if (old && old.path !== path) this.ports.remove(old.path);
            this.redo = false;
        } else if (path && path !== this.recording?.path) this.ports.remove(path);
        this.refreshRecording();
        this.publish({ status: this.idle(), error: rec.session !== this.session ? '' : valid
            ? (rec.interrupted ? '录音已中断，可回听或重录' : '')
            : rec.started ? '未能保存录音，请再试一次' : '录音未开始，请重试' });
        this.lock();
    }
    rerecord() {
        if (this.rec || this.state.status === 'preparing') return;
        this.stopPlayback(); this.redo = true; this.publish({ status: 'ready', error: '' });
    }
    play(source, compare = false) {
        if (this.cleanupSuspended || !this.state.open || !this.foreground || this.rec || this.state.status === 'preparing') return;
        if (this.state.source === source && !compare && !this.state.comparing) { this.stopPlayback(); return; }
        this.stopPlayback();
        if ((source === 'original' && !this.state.reliable) || ((compare || source === 'mine') && !this.matching())) return;
        const op = this.op; this.publish({ comparing: compare, originalDone: false, error: '' });
        this.playPart(source, compare, op);
    }
    playPart(source, compare, op) {
        if (op !== this.op || !this.state.open || !this.foreground) return;
        this.publish({ source, status: 'playing', sourceStatus: 'loading', currentTime: 0,
            sourceDuration: source === 'mine' ? this.recording.duration : this.target.sentence.duration });
        const current = () => op === this.op && this.state.open && this.foreground && this.state.source === source;
        const events = {
            update: (status, time, duration) => { if (current()) this.publish({ sourceStatus: status, currentTime: time, sourceDuration: duration }); },
            error: error => {
                if (!current()) return;
                this.stopPlayback();
                const forbidden = ['BOOK_FORBIDDEN', 'BUILD_REVOKED', 'BUILD_RETIRED', 'BUILD_UPDATE_REQUIRED', 'SESSION_EXPIRED', 'SENTENCE_UNPLAYABLE'].includes(error?.code);
                this.publish({ error: source === 'mine' ? '录音暂时无法播放，请重试或重录' : '原音暂时无法播放，请重试',
                    reliable: forbidden ? false : this.state.reliable });
            },
            ended: () => {
                if (!current()) return;
                const sound = this.sound; this.sound = null; sound?.stop();
                if (compare && source === 'original') {
                    this.publish({ originalDone: true, source: 'gap', sourceStatus: 'waiting' });
                    this.gap = setTimeout(() => { this.gap = null; this.playPart('mine', true, op); }, 500);
                } else this.stopPlayback();
            }
        };
        try { const sound = source === 'original'
            ? this.ports.original(this.target, compare ? 1 : this.target.speed, events)
            : this.ports.mine(this.recording.path, events);
            if (current() && this.state.source === source) this.sound = sound;
            else sound.stop(); }
        catch (error) { events.error(error); }
    }
}
module.exports = { Shadowing, initialShadowing, targetKey };
