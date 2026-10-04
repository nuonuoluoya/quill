const { shadowing, shadowState } = require('../../models/shadowing');
const { subscribe } = require('../../utils/events');
const { timeLabel } = require('../../utils/contracts');
Component({
    data: { state: {}, clock: '00:00', statusText: '', privacyNeeded: false, privacyChecking: false },
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
            const duration = value => Number.isFinite(value) && value > 0 ? timeLabel(value) : '--:--';
            const source = s.source === 'original' ? '原音' : '我的录音';
            const statusText = s.error || (s.source
                ? (s.sourceStatus === 'loading' ? '正在准备' + source
                    : s.sourceStatus === 'buffering' ? source + '缓冲中'
                    : '正在听' + (s.source === 'original' ? '原音' : '我的') + ' · ' + timeLabel(s.currentTime) + ' / ' + duration(s.sourceDuration))
                : s.status === 'preparing' ? '正在准备录音'
                    : s.status === 'saving' ? '正在保存录音'
                    : !s.reliable ? '本句暂无可用原音'
                        : s.hasRecording ? '录音完成 · ' + duration(s.duration) : '听一遍，再读一遍');
            this.setData({ state: { ...s }, clock: timeLabel(s.elapsed), statusText });
        },
        close() { shadowing.close(); }, noop() {},
        active() { if (this.visible === false || !shadowState.open) return false; shadowing.resume(); return true; },
        record() {
            if (this.data.privacyChecking || this.data.privacyNeeded || !shadowState.reliable || ['preparing', 'recording', 'saving'].includes(shadowState.status) || !this.active()) return;
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
        finish() {
            this.privacyRequest = (this.privacyRequest || 0) + 1;
            this.setData({ privacyChecking: false, privacyNeeded: false });
            shadowing.stopRecording();
        },
        original() { if (!this.data.privacyChecking && this.active()) shadowing.play('original'); }, mine() { if (!this.data.privacyChecking && this.active()) shadowing.play('mine'); },
        settings() { wx.openSetting({ success() {}, fail() { shadowing.publish({ error: '无法打开设置，请在微信中开启麦克风后重试' }); } }); }
    }
});
