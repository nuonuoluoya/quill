const { player, playerState } = require('../../models/player');
const { speeds, timeLabel } = require('../../utils/contracts');
const { subscribe } = require('../../utils/events');
Component({
    properties: { chapter: Object, title: String, frozen: Boolean, isPodcast: Boolean },
    data: { state: {}, speeds, speedOpen: false, percent: 0, current: '00:00', duration: '00:00', loadingModal: false, loadingKind: 'loading' },
    lifetimes: {
        attached() { this.alive = true; this.visible = true; this.off = subscribe(() => this.refresh()); this.refresh(); },
        detached() { this.alive = false; this.off(); this.clearLoading(); }
    },
    pageLifetimes: {
        show() { this.visible = true; this.refresh(); },
        hide() { this.visible = false; this.clearLoading(); }
    },
    methods: {
        refresh() { const s = playerState; this.setData({ state: { ...s }, percent: s.duration ? Math.min(100, s.currentTime / s.duration * 100) : 0, current: timeLabel(s.currentTime), duration: timeLabel(s.duration), number: String(s.index + 1), total: String((this.properties.chapter.sentences || []).length) }); this.updateLoading(s); },
        updateLoading(s) {
            const waiting = !s.error && (s.status === 'loading' || (s.status === 'playing' && s.buffering));
            if (!this.alive || !this.visible || !waiting) { this.clearLoading(); return; }
            const chapter = this.properties.chapter || {};
            const key = JSON.stringify([chapter.bookId, chapter.buildId, chapter.chapterId, s.mode, s.index]);
            const kind = s.status === 'loading' ? 'loading' : 'buffering';
            if (this.data.loadingKind !== kind) this.setData({ loadingKind: kind });
            if (key === this.loadingKey) return;
            this.clearLoading();
            this.loadingKey = key;
            const version = this.loadingVersion;
            this.loadingTimer = setTimeout(() => {
                if (this.loadingVersion !== version) return;
                this.loadingTimer = undefined;
                if (this.alive && this.visible && this.loadingKey === key)
                    this.setData({ loadingModal: true });
            }, 1000);
        },
        clearLoading() {
            this.loadingVersion = (this.loadingVersion || 0) + 1;
            clearTimeout(this.loadingTimer);
            this.loadingTimer = undefined;
            this.loadingKey = '';
            if (this.alive && this.data.loadingModal) this.setData({ loadingModal: false });
        },
        cancelLoading() { this.clearLoading(); player.pause(); },
        preventMove() {},
        action(e) { if (this.properties.frozen)
            return; const a = e.currentTarget.dataset.action; if (a === 'previous')
            player.navigate(-1); if (a === 'next')
            player.navigate(1); if (a === 'toggle')
            player.toggle(); if (a === 'restart')
            player.restart(); if (a === 'sentence')
            player.sentenceMode(); if (a === 'loop')
            player.setLoop(!playerState.loop); if (a === 'continuous')
            player.setContinuous(!playerState.continuous); },
        shadow() { if (!this.properties.frozen) this.triggerEvent('shadow'); },
        locate() { this.triggerEvent('locate'); },
        speedPanel() { this.setData({ speedOpen: !this.data.speedOpen }); },
        speed(e) { if (this.properties.frozen)
            return; const v = Number(e.currentTarget.dataset.value); player.setSpeed(v); this.setData({ speedOpen: false }); this.triggerEvent('speed', { speed: v }); }
    }
});
