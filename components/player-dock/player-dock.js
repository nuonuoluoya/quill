const { player, playerState } = require('../../models/player');
const { speeds, timeLabel } = require('../../utils/contracts');
const { subscribe } = require('../../utils/events');
Component({
    properties: { chapter: Object, title: String, frozen: Boolean, isPodcast: Boolean },
    data: { state: {}, speeds, speedOpen: false, percent: 0, current: '00:00', duration: '00:00' },
    lifetimes: { attached() { this.off = subscribe(() => this.refresh()); this.refresh(); }, detached() { this.off(); } },
    methods: {
        refresh() { const s = playerState; this.setData({ state: { ...s }, percent: s.duration ? Math.min(100, s.currentTime / s.duration * 100) : 0, current: timeLabel(s.currentTime), duration: timeLabel(s.duration), number: String(s.index + 1).padStart(3, '0'), total: String((this.properties.chapter.sentences || []).length).padStart(3, '0') }); },
        action(e) { if (this.properties.frozen)
            return; const a = e.currentTarget.dataset.action; if (a === 'previous')
            player.navigate(-1); if (a === 'next')
            player.navigate(1); if (a === 'toggle')
            player.toggle(); if (a === 'restart')
            player.restart(); if (a === 'sentence')
            player.sentenceMode(); if (a === 'loop')
            player.setLoop(!playerState.loop); if (a === 'continuous')
            player.setContinuous(!playerState.continuous); },
        locate() { this.triggerEvent('locate'); },
        speedPanel() { this.setData({ speedOpen: !this.data.speedOpen }); },
        speed(e) { if (this.properties.frozen)
            return; const v = Number(e.currentTarget.dataset.value); player.setSpeed(v); this.setData({ speedOpen: false }); this.triggerEvent('speed', { speed: v }); }
    }
});
