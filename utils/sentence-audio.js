// Download only the selected sentence. The file belongs to this audio instance,
// is never saved as persistent content, and is removed when the instance stops.
function sentenceAudio(wxApi, native) {
    let generation = 0;
    let disposed = false;
    let task = null;
    let tempPath = '';
    let errorListener = () => {};
    const remove = path => {
        if (!path) return;
        try { wxApi.getFileSystemManager().unlink({ filePath: path, fail() {} }); }
        catch (_) { /* The platform also manages the lifetime of temporary files. */ }
    };
    const cancel = () => {
        generation++;
        const pending = task;
        task = null;
        if (pending) pending.abort();
    };
    const release = () => {
        const path = tempPath;
        tempPath = '';
        remove(path);
    };
    const adapter = {
        play() { if (!disposed && tempPath) native.play(); },
        pause() { native.pause(); },
        seek(time) { native.seek(time); },
        stop() { cancel(); native.stop(); release(); },
        destroy() {
            if (disposed) return;
            disposed = true;
            cancel();
            native.destroy();
            release();
        },
        onError(listener) { errorListener = listener; native.onError(listener); }
    };
    for (const event of ['Canplay', 'Play', 'Pause', 'Ended', 'TimeUpdate', 'Seeked', 'Waiting']) {
        if (typeof native['on' + event] === 'function')
            adapter['on' + event] = listener => native['on' + event](listener);
    }
    for (const key of ['autoplay', 'loop', 'obeyMuteSwitch', 'currentTime', 'duration', 'buffered', 'playbackRate']) {
        if (key in native)
            Object.defineProperty(adapter, key, { get: () => native[key], set: value => { native[key] = value; } });
    }
    Object.defineProperty(adapter, 'src', {
        get: () => native.src,
        set(url) {
            if (disposed) return;
            cancel();
            release();
            const op = generation;
            let completed = false;
            const current = () => !disposed && op === generation;
            const fail = () => {
                completed = true;
                if (!current()) return;
                task = null;
                errorListener({ errMsg: '当前句音频下载失败' });
            };
            try {
                const pending = wxApi.downloadFile({
                    url,
                    timeout: 15000,
                    success(result) {
                        completed = true;
                        if (!current()) { remove(result.tempFilePath); return; }
                        task = null;
                        if (result.statusCode !== 200 || !result.tempFilePath) {
                            remove(result.tempFilePath);
                            fail();
                            return;
                        }
                        tempPath = result.tempFilePath;
                        native.src = tempPath;
                    },
                    fail
                });
                if (!completed && current()) task = pending;
                else if (!completed) pending.abort();
            } catch (_) { fail(); }
        }
    });
    return adapter;
}
module.exports = { sentenceAudio };
