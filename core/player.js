"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Player = exports.initialPlayer = void 0;
const contracts_1 = require("../utils/contracts");
const initialPlayer = () => ({
    mode: 'sentence',
    status: 'selected',
    index: 0,
    currentTime: 0,
    duration: 0,
    speed: 1,
    effectiveSpeed: 1,
    speedSupported: true,
    loop: false,
    continuous: false,
    error: '',
    buffering: false,
});
exports.initialPlayer = initialPlayer;
class Player {
    constructor(state, factory, authorize, now = () => Date.now()) {
        this.state = state;
        this.factory = factory;
        this.authorize = authorize;
        this.now = now;
        this.audio = null;
        this.generation = 0;
        this.intent = 0;
        this.allowed = false;
        this.foreground = true;
        this.changedAt = 0;
        this.waitStarted = 0;
        this.phaseDeadline = 0;
        this.retries = 0;
        this.offset = 0;
        this.seeking = false;
        this.book = null;
        this.chapter = null;
        this.onSelection = () => { };
    }
    load(book, chapter, index = 0) {
        this.dispose();
        this.book = book;
        this.chapter = chapter;
        Object.assign(this.state, (0, exports.initialPlayer)(), {
            speed: this.state.speed,
            effectiveSpeed: this.state.effectiveSpeed,
            index: Math.max(0, Math.min(index, chapter.sentences.length - 1)),
        });
        if (!chapter.sentences.length)
            this.state.status = 'unavailable';
        else
            this.state.status = (0, contracts_1.playable)(chapter.sentences[this.state.index])
                ? 'selected'
                : 'unavailable';
        this.foreground = true;
    }
    destroy() {
        this.generation++;
        this.state.buffering = false;
        this.seeking = false;
        const old = this.audio;
        this.audio = null;
        if (old) {
            old.stop();
            old.destroy();
        }
        if (this.clock)
            clearInterval(this.clock);
        this.clock = undefined;
    }
    dispose() {
        this.allowed = false;
        this.intent++;
        this.destroy();
        this.grant = undefined;
        this.state.loop = false;
        this.state.continuous = false;
        this.state.currentTime = 0;
        this.state.status = 'selected';
    }
    setForeground(value) {
        this.foreground = value;
        if (!value) {
            this.pause();
            this.state.loop = false;
            this.state.continuous = false;
        }
    }
    pause() {
        var _a;
        this.state.buffering = false;
        this.allowed = false;
        this.intent++;
        (_a = this.audio) === null || _a === void 0 ? void 0 : _a.pause();
        if (this.state.status === 'loading') {
            this.destroy();
            this.state.status = 'selected';
        }
        else if (this.state.status === 'playing')
            this.state.status = 'paused';
    }
    setSpeed(speed, supported = this.state.speedSupported) {
        this.state.speed = speed;
        this.state.speedSupported = supported;
        this.state.effectiveSpeed = supported ? speed : 1;
        if (this.audio && supported)
            this.audio.playbackRate = this.state.effectiveSpeed;
    }
    setLoop(value) {
        this.state.loop = value;
        if (value)
            this.state.continuous = false;
    }
    setContinuous(value) {
        this.state.continuous = value;
        if (value)
            this.state.loop = false;
    }
    select(index, play = false) {
        if (!this.chapter || !this.chapter.sentences[index])
            return;
        this.allowed = false;
        this.intent++;
        this.destroy();
        this.grant = undefined;
        this.state.mode = 'sentence';
        this.state.index = index;
        this.state.currentTime = 0;
        this.state.duration = this.chapter.sentences[index].duration || 0;
        this.state.error = '';
        this.state.status = (0, contracts_1.playable)(this.chapter.sentences[index]) ? 'selected' : 'unavailable';
        this.onSelection(index);
        if (play && this.state.status !== 'unavailable')
            void this.start();
    }
    clickSentence(index) {
        if (this.state.mode === 'sentence' && this.state.index === index)
            this.toggle();
        else
            this.select(index, true);
    }
    navigate(delta) {
        const play = this.state.status === 'playing' || this.state.status === 'loading';
        this.select(this.state.index + delta, play);
    }
    chapterPlay() {
        var _a;
        if (((_a = this.chapter) === null || _a === void 0 ? void 0 : _a.chapterAudio.status) !== 'available')
            return;
        this.pause();
        this.destroy();
        this.grant = undefined;
        Object.assign(this.state, {
            mode: 'chapter',
            currentTime: 0,
            duration: this.chapter.chapterAudio.duration || 0,
            loop: false,
            continuous: false,
            status: 'selected',
            error: '',
        });
        void this.start();
    }
    sentenceMode() {
        var _a;
        const i = this.state.index;
        this.pause();
        this.destroy();
        this.grant = undefined;
        this.state.mode = 'sentence';
        this.state.currentTime = 0;
        this.state.status =
            ((_a = this.chapter) === null || _a === void 0 ? void 0 : _a.sentences[i]) && (0, contracts_1.playable)(this.chapter.sentences[i])
                ? 'selected'
                : 'unavailable';
    }
    restart() {
        this.pause();
        this.destroy();
        this.grant = undefined;
        this.state.currentTime = 0;
        void this.start();
    }
    toggle() {
        if (this.state.status === 'playing' || this.state.status === 'loading')
            this.pause();
        else if (this.state.status !== 'unavailable')
            void this.start();
    }
    async start(retry = false) {
        if (!this.book || !this.chapter || !this.foreground)
            return;
        if (this.state.mode === 'sentence' &&
            (!this.chapter.sentences[this.state.index] ||
                !(0, contracts_1.playable)(this.chapter.sentences[this.state.index]))) {
            this.state.status = 'unavailable';
            return;
        }
        if (!retry && this.state.mode === 'sentence' && this.state.status === 'selected')
            this.onSelection(this.state.index);
        this.allowed = true;
        const intent = ++this.intent;
        if (!retry) {
            this.retries = 0;
            this.waitStarted = this.now();
        }
        const offset = this.state.status === 'ended' ? 0 : this.state.currentTime;
        this.state.currentTime = offset;
        const age = this.grant ? this.now() - this.grant.received : Infinity, remaining = (this.state.duration - offset) / this.state.effectiveSpeed + 30;
        if (this.audio &&
            this.grant &&
            age >= 0 &&
            this.grant.ttl - age / 1000 > remaining &&
            this.state.status === 'paused') {
            this.state.status = 'loading';
            this.phaseDeadline = this.now() + 15000;
            this.audio.playbackRate = this.state.effectiveSpeed;
            this.audio.play();
            return;
        }
        this.destroy();
        const gen = this.generation;
        this.state.status = 'loading';
        this.state.error = '';
        this.offset = offset;
        this.phaseDeadline = this.now() + 25000;
        const valid = () => gen === this.generation && this.intent === intent && this.allowed && this.foreground;
        this.clock = setInterval(() => {
            if (gen !== this.generation || !this.allowed)
                return;
            if (this.state.status === 'loading' &&
                (this.now() > this.phaseDeadline || this.now() - this.waitStarted > 60000))
                this.failure('音频加载超时，请重试');
            if (this.state.status === 'playing' && this.now() - this.changedAt > 15000)
                this.failure('音频缓冲超时，请检查网络');
        }, 500);
        try {
            const mode = this.state.mode, id = mode === 'chapter' ? this.chapter.chapterId : this.chapter.sentences[this.state.index].id, started = this.now();
            const grant = await this.authorize(this.book, id, mode);
            if (!valid())
                return;
            if (!grant.audioId || !grant.url || !Number.isFinite(grant.duration) || grant.duration <= 0)
                throw Error('音频授权格式错误');
            this.grant = {
                ttl: (Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt)) / 1000 -
                    (this.now() - started) / 1000,
                received: this.now(),
            };
            this.state.duration = grant.duration;
            const audio = this.factory({ mode });
            this.audio = audio;
            audio.autoplay = false;
            audio.loop = false;
            this.setSpeed(this.state.speed, 'playbackRate' in audio);
            this.phaseDeadline = this.now() + 15000;
            const current = () => gen === this.generation && audio === this.audio;
            let startIssued = false;
            audio.onCanplay(() => {
                if (!valid() || this.state.status !== 'loading' || this.seeking || startIssued)
                    return;
                startIssued = true;
                if (this.offset > 0) {
                    this.seeking = true;
                    this.phaseDeadline = this.now() + 10000;
                    audio.seek(Math.min(this.offset, grant.duration));
                }
                else
                    audio.play();
            });
            audio.onSeeked(() => {
                if (!current() || !this.allowed || !this.foreground || !this.seeking)
                    return;
                this.seeking = false;
                if (Math.abs(audio.currentTime - this.offset) > 1) {
                    this.failure('无法恢复原播放位置，请重试或从头播放', false);
                    return;
                }
                audio.play();
            });
            audio.onPlay(() => {
                if (!current())
                    return;
                if (!this.allowed || !this.foreground) {
                    audio.pause();
                    return;
                }
                this.state.status = 'playing';
                this.state.buffering = false;
                this.changedAt = this.now();
            });
            audio.onPause(() => {
                if (current() && this.state.status === 'playing') {
                    this.state.status = 'paused';
                    this.state.buffering = false;
                }
            });
            if (audio.onWaiting) audio.onWaiting(() => {
                if (current() && this.allowed && this.foreground && this.state.status === 'playing')
                    this.state.buffering = true;
            });
            audio.onTimeUpdate(() => {
                if (!current() || this.seeking || !this.allowed || this.state.status !== 'playing')
                    return;
                const t = audio.currentTime;
                if (Number.isFinite(t) && t >= 0) {
                    if (t !== this.state.currentTime) {
                        this.changedAt = this.now();
                        this.state.buffering = false;
                    }
                    this.state.currentTime = t;
                }
            });
            audio.onError(() => {
                if (current() && this.allowed)
                    this.failure('音频暂时无法播放，请检查网络');
            });
            audio.onEnded(() => {
                if (!current() || !this.allowed || !this.foreground)
                    return;
                this.state.status = 'ended';
                this.state.buffering = false;
                this.state.currentTime = grant.duration;
                this.allowed = false;
                if (mode === 'sentence' && this.state.loop) {
                    this.state.currentTime = 0;
                    void this.start();
                }
                else if (mode === 'sentence' &&
                    this.state.continuous &&
                    this.state.index < this.chapter.sentences.length - 1)
                    this.select(this.state.index + 1, true);
            });
            audio.src = grant.url;
        }
        catch (e) {
            if (valid()) {
                const code = e === null || e === void 0 ? void 0 : e.code;
                this.failure(e instanceof Error ? e.message : '音频授权失败', ![
                    'BOOK_FORBIDDEN',
                    'BUILD_REVOKED',
                    'BUILD_RETIRED',
                    'BUILD_UPDATE_REQUIRED',
                    'SESSION_EXPIRED',
                    'SENTENCE_UNPLAYABLE',
                    'CHAPTER_AUDIO_UNAVAILABLE',
                ].includes(code));
            }
        }
    }
    failure(message, retry = true) {
        if (!this.allowed)
            return;
        if (this.state.status === 'playing')
            this.waitStarted = this.now();
        this.destroy();
        this.grant = undefined;
        this.state.status = 'error';
        this.state.error = message;
        this.state.loop = false;
        this.state.continuous = false;
        if (retry && this.retries++ < 1 && this.foreground && this.now() - this.waitStarted < 60000) {
            void this.start(true);
        }
        else {
            this.allowed = false;
            this.intent++;
        }
    }
}
exports.Player = Player;
