const { audioFiles } = require('../utils/audio-files');
const { observable } = require('../utils/events');
const { player } = require('./player');
const { shadowing } = require('./shadowing');
const cleanupState = observable({ busy: false, result: '' });
const messages = { success: '音频缓存已清除', empty: '暂无可清理的音频缓存',
    partial: '部分音频文件未能清除，请重试', failed: '清理未完成，请重试' };
let job;
function clearAudio() {
    if (job) return job;
    cleanupState.busy = true; cleanupState.result = '';
    player.cleanupSuspended = true; shadowing.cleanupSuspended = true;
    job = audioFiles(wx).clear(() => { try { player.dispose(); } finally { shadowing.reset(); } }).then(result => {
        cleanupState.result = messages[result]; return result;
    }).finally(() => {
        player.cleanupSuspended = false; shadowing.cleanupSuspended = false;
        cleanupState.busy = false; job = null;
    });
    return job;
}
module.exports = { cleanupState, clearAudio };
