const { AudioFiles } = require('../core/audio-files');
const registries = new WeakMap();
const validTemporaryPath = p => typeof p === 'string' && p.length < 4096 &&
    /^(wxfile:\/\/tmp|https?:\/\/tmp\/)/.test(p) && !/\.\.|%2e|[\0\\]/i.test(p);
function audioFiles(api) {
    if (registries.has(api)) return registries.get(api);
    const key = 'pidan:' + require('../config/config').environment + ':audio-files:v1';
    const files = new AudioFiles({
        valid: validTemporaryPath,
        load: () => api.getStorageSync(key) || undefined,
        save: value => api.setStorageSync(key, value),
        unlink: filePath => new Promise((resolve, reject) => {
            let done = false;
            const finish = (ok, result) => { if (done) return; done = true; clearTimeout(timer); (ok ? resolve : reject)(result); };
            const timer = setTimeout(() => finish(false), 5000);
            try { api.getFileSystemManager().unlink({ filePath, success: () => finish(true), fail: error => {
                const missing = [1300002, 1301112].includes(error?.errno) || /no such file|not exist|ENOENT/i.test(error?.errMsg || '');
                finish(missing, missing ? 'missing' : undefined);
            } }); } catch { finish(false); }
        })
    });
    registries.set(api, files); return files;
}
module.exports = { audioFiles, validTemporaryPath };
