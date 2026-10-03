const { shadowing, shadowState } = require('../../models/shadowing');
const { subscribe } = require('../../utils/events');
const { timeLabel } = require('../../utils/contracts');
Component({
    data: { state: {}, clock: '00:00', duration: '00:00', current: '00:00', end: '00:00', percent: 0, privacyNeeded: false, privacyChecking: false },
    lifetimes: {
        attached() {
            this.alive = true;
            this.off = subscribe(() => this.refresh()); this.refresh();
            this.interrupted = () => shadowing.interrupt(); this.resumed = () => { if (this.visible !== false) shadowing.resume(); };
            wx.onAudioInterruptionBegin?.(this.interrupted); wx.onAudioInterruptionEnd?.(this.resumed);
        },
        detached() { this.alive = false; this.off(); wx.offAudioInterruptionBegin?.(this.interrupted); wx.offAudioInterruptionEnd?.(this.resumed); }
    },
    pageLifetimes: { show() { this.visible = true; shadowing.resume(); }, hide() { this.visible = false; this.privacyRequest = (this.privacyRequest || 0) + 1; this.setData({ privacyChecking: false, privacyNeeded: false }); shadowing.interrupt(); } },
    methods: {
        refresh() {
            const s = shadowState;
            if ((!s.open || !shadowing.foreground || this.privacyOp !== shadowing.op) && (this.data.privacyNeeded || this.data.privacyChecking)) this.setData({ privacyNeeded: false, privacyChecking: false });
            this.setData({ state: { ...s }, clock: timeLabel(s.elapsed), duration: timeLabel(s.duration), current: timeLabel(s.currentTime),
                end: timeLabel(s.sourceDuration), percent: s.sourceDuration ? Math.max(0, Math.min(100, s.currentTime / s.sourceDuration * 100)) : 0 });
        },
        close() { shadowing.close(); }, noop() {},
        active() { if (this.visible === false || !shadowState.open) return false; shadowing.resume(); return true; },
        record() {
            if (this.data.privacyChecking || !this.active()) return;
            shadowing.stopPlayback();
            if (!wx.getPrivacySetting) { void shadowing.startRecording(); return; }
            const op = shadowing.op;
            this.privacyOp = op;
            const request = this.privacyRequest = (this.privacyRequest || 0) + 1;
            this.setData({ privacyChecking: true });
            wx.getPrivacySetting({ success: result => {
                if (!this.alive || request !== this.privacyRequest || op !== shadowing.op || !shadowState.open) return;
                this.privacyOp = op;
                this.setData({ privacyChecking: false, privacyNeeded: !!result.needAuthorization });
                if (!result.needAuthorization) void shadowing.startRecording();
            }, fail: () => { if (this.alive && request === this.privacyRequest && op === shadowing.op && shadowState.open) { this.setData({ privacyChecking: false }); shadowing.publish({ error: '无法获取隐私授权状态，请重试' }); } } });
        },
        privacyAgreed() { const valid = this.alive && this.visible !== false && this.data.privacyNeeded && this.privacyOp === shadowing.op; this.setData({ privacyNeeded: false }); if (valid && shadowState.open && shadowing.foreground) void shadowing.startRecording(); },
        privacyContract() { wx.openPrivacyContract({ fail() { shadowing.publish({ error: '暂时无法打开隐私说明，请稍后重试' }); } }); },
        finish() { shadowing.stopRecording(); },
        original() { if (!this.data.privacyChecking && this.active()) shadowing.play('original'); }, mine() { if (!this.data.privacyChecking && this.active()) shadowing.play('mine'); },
        compare() { if (this.data.privacyChecking || !this.active()) return; if (shadowState.comparing) shadowing.stopPlayback(); else shadowing.play('original', true); },
        stop() { shadowing.stopPlayback(); }, redo() { shadowing.rerecord(); },
        settings() { wx.openSetting({ success() {}, fail() { shadowing.publish({ error: '无法打开设置，请在微信中开启麦克风后重试' }); } }); }
    }
});
