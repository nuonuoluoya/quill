const { player } = require('./models/player');
const { progressStore } = require('./models/progress');
App({
    visible: true,
    onLaunch() {
        // Devtools exposes this API but rejects it as unsupported. Keep the
        // per-instance fallback there; real and unidentified devices still try it.
        let platform = '';
        try {
            const device = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo()
                : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null;
            platform = device?.platform || '';
        } catch (_) { /* Unknown platforms must retain the real-device policy. */ }
        if (platform !== 'devtools' && typeof wx.setInnerAudioOption === 'function') {
            const failed = () => console.warn('音频静音策略设置失败，将使用播放器实例设置');
            try { wx.setInnerAudioOption({ obeyMuteSwitch: false, fail: failed }); }
            catch (_) { failed(); }
        }
        wx.onNetworkStatusChange(r => { progressStore.online.value = r.isConnected; if (r.isConnected)
            progressStore.resume(); });
        wx.getNetworkType({ success: r => { progressStore.online.value = r.networkType !== 'none'; } });
        wx.onAudioInterruptionBegin(() => player.setForeground(false));
        wx.onAudioInterruptionEnd(() => { if (this.visible)
            player.setForeground(true); });
    },
    onShow() { this.visible = true; progressStore.resume(); },
    onHide() { this.visible = false; player.setForeground(false); progressStore.flushAll(); }
});
