"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.progressStore = void 0;
const events_1 = require("../utils/events");
const sync_1 = require("../core/sync");
const auth_1 = require("./auth");
const http_1 = require("../utils/http");
const content_1 = require("./content");
const { unitTitle } = require('../utils/catalog');
const records = new Map(), timers = new Map(), oldest = new Map();
const tick = (0, events_1.ref)(0), online = (0, events_1.ref)(true), enc = encodeURIComponent;
const prefix = () => `pidan:${http_1.environment}:${(0, auth_1.identity)()}:`;
async function retry(fn) {
    for (let n = 0;; n++) {
        try {
            return await fn();
        }
        catch (e) {
            if (n >= 3 || (e === null || e === void 0 ? void 0 : e.code) === 'STALE_IDENTITY' || !(e instanceof http_1.ApiError) || (e.status !== 0 && e.status < 500))
                throw e;
            await new Promise((r) => setTimeout(r, 1000 * 2 ** n));
        }
    }
}
function get(book) {
    const key = prefix() + `progress:${enc(book.bookId)}:${enc(book.textRevision)}`;
    if (records.has(key))
        return records.get(key);
    const user = (0, auth_1.identity)(), transport = user === 'guest'
        ? null
        : {
            async rebase(b, p) {
                const active = await content_1.content.book(b);
                if (active.textRevision !== p.textRevision)
                    return null;
                const chapter = await content_1.content.chapter(active, p.chapterId);
                if (!chapter.sentences.some((s) => s.id === p.sentenceId))
                    return null;
                return { ...p, sourceBuildId: active.buildId };
            },
            get: (b, r) => (0, auth_1.api)(`/me/progress/${enc(b)}?textRevision=${enc(r)}`),
            put: (b, p) => retry(() => {
                if ((0, auth_1.identity)() !== user)
                    throw new http_1.ApiError('STALE_IDENTITY', '账号已切换');
                return (0, auth_1.api)(`/me/progress/${enc(b)}`, 'PUT', p);
            }),
            reset: (b, p) => retry(() => {
                if ((0, auth_1.identity)() !== user)
                    throw new http_1.ApiError('STALE_IDENTITY', '账号已切换');
                return (0, auth_1.api)(`/me/progress/${enc(b)}/reset`, 'POST', p);
            }),
        };
    const r = new sync_1.SyncRecord(key, book.bookId, book.textRevision, http_1.storage, transport, http_1.uuid);
    r.onChange = () => {
        tick.value++;
        if (r.status === '待同步' &&
            r.state.dirty &&
            !r.state.conflict &&
            !r.state.deferred &&
            !timers.has(key)) {
            timers.set(key, setTimeout(() => {
                timers.delete(key);
                void r.flush();
            }, 2000));
        }
    };
    records.set(key, r);
    return r;
}
exports.progressStore = {
    tick,
    online,
    get,
    hasPending() {
        return [...records.values()].some((r) => r.state.dirty || r.state.inflight || r.state.resetting);
    },
    position(b, progress) {
        var _a;
        const chapter = b.contentType === 'tv' ? unitTitle(b, progress.chapterId) : (((_a = b.chapters.find((c) => c.id === progress.chapterId)) === null || _a === void 0 ? void 0 : _a.title) || '已保存章节');
        try {
            const p = http_1.storage.get(prefix() + `position:${enc(b.bookId)}:${enc(b.textRevision)}`);
            if ((p === null || p === void 0 ? void 0 : p.chapterId) === progress.chapterId &&
                (p === null || p === void 0 ? void 0 : p.sentenceId) === progress.sentenceId &&
                Number.isInteger(p.index) &&
                p.index > 0)
                return `${chapter} · 第 ${String(p.index).padStart(3, '0')} 句`;
        }
        catch { }
        return `${chapter} · 已保存句子位置`;
    },
    update(b, progress, index) {
        const r = get(b);
        const key = prefix() + `progress:${enc(b.bookId)}:${enc(b.textRevision)}`;
        if (timers.has(key))
            clearTimeout(timers.get(key));
        timers.delete(key);
        r.update(progress);
        if (!r.state.resetting) {
            try {
                http_1.storage.set(prefix() + 'recent', b.bookId);
                if (index)
                    http_1.storage.set(prefix() + `position:${enc(b.bookId)}:${enc(b.textRevision)}`, {
                        chapterId: progress.chapterId,
                        sentenceId: progress.sentenceId,
                        index,
                    });
            }
            catch { }
        }
        if (timers.has(key))
            clearTimeout(timers.get(key));
        if (!oldest.has(key))
            oldest.set(key, Date.now());
        const delay = Math.max(0, Math.min(2000, 10000 - (Date.now() - oldest.get(key))));
        timers.set(key, setTimeout(() => {
            timers.delete(key);
            oldest.delete(key);
            void r.flush();
        }, delay));
    },
    recent() {
        try {
            return http_1.storage.get(prefix() + 'recent') || null;
        }
        catch {
            return null;
        }
    },
    forgetRecent(bookId) {
        if (this.recent() === bookId)
            try {
                http_1.storage.remove(prefix() + 'recent');
            }
            catch { }
    },
    flushAll() {
        for (const r of records.values())
            void r.flush();
    },
    resume() {
        try {
            for (const key of http_1.storage.keys()) {
                if (!key.startsWith(prefix() + 'progress:'))
                    continue;
                const p = http_1.storage.get(key);
                if ((p === null || p === void 0 ? void 0 : p.schema) === 1)
                    get(p);
            }
        }
        catch { }
        this.flushAll();
    },
    status(b) {
        tick.value;
        const r = get(b);
        if (!r.saved)
            return '本机保存不可用';
        if (!online.value)
            return '网络已断开 · 进度已保存在本机';
        return r.status || ((0, auth_1.identity)() === 'guest' ? '仅保存在本机' : '尚无阅读进度');
    },
};
(0, auth_1.onIdentityChange)(() => {
    for (const r of records.values())
        r.stop();
    records.clear();
    for (const t of timers.values())
        clearTimeout(t);
    timers.clear();
    oldest.clear();
    tick.value++;
});
