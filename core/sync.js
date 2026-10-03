"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncRecord = void 0;
exports.validLocal = validLocal;
const contracts_1 = require("../utils/contracts");
function validLocal(v) {
    var _a;
    return ((v === null || v === void 0 ? void 0 : v.schema) === 1 &&
        typeof v.bookId === 'string' &&
        typeof v.textRevision === 'string' &&
        (v.version === null || (Number.isSafeInteger(v.version) && v.version >= 0)) &&
        Number.isSafeInteger(v.revision) &&
        typeof v.dirty === 'boolean' &&
        Number.isFinite(v.createdAt) &&
        (!v.progress ||
            (v.progress.bookId === v.bookId &&
                v.progress.textRevision === v.textRevision &&
                typeof v.progress.sourceBuildId === 'string' &&
                typeof v.progress.chapterId === 'string' &&
                typeof v.progress.sentenceId === 'string' &&
                (0, contracts_1.isSpeed)(v.progress.preferredSpeed))) &&
        (!v.inflight ||
            (['put', 'reset'].includes(v.inflight.kind) &&
                typeof ((_a = v.inflight.body) === null || _a === void 0 ? void 0 : _a.clientMutationId) === 'string' &&
                v.inflight.body.textRevision === v.textRevision &&
                Number.isSafeInteger(v.inflight.body.expectedVersion))));
}
class SyncRecord {
    constructor(key, bookId, textRevision, cache, transport, uuid, now = () => Date.now()) {
        this.key = key;
        this.cache = cache;
        this.transport = transport;
        this.uuid = uuid;
        this.now = now;
        this.status = '';
        this.saved = true;
        this.job = null;
        this.cancelled = false;
        this.onChange = () => { };
        this.state = {
            schema: 1,
            bookId,
            textRevision,
            version: null,
            revision: 0,
            dirty: false,
            progress: null,
            createdAt: this.now(),
        };
        try {
            const old = cache.get(key);
            if (old) {
                if (!validLocal(old) || old.bookId !== bookId || old.textRevision !== textRevision) {
                    this.status = '本机进度损坏，未自动恢复';
                }
                else
                    this.state = old;
            }
        }
        catch {
            this.saved = false;
            this.status = '本机保存不可用';
        }
    }
    notify() {
        this.onChange();
    }
    persist() {
        try {
            this.cache.set(this.key, JSON.parse(JSON.stringify(this.state)));
            this.saved = true;
        }
        catch {
            this.saved = false;
        }
        this.notify();
    }
    update(progress) {
        if (this.state.resetting)
            return;
        const s = this.state;
        s.progress = progress;
        s.revision++;
        if (!s.dirty)
            s.createdAt = this.now();
        s.dirty = true;
        this.status = this.transport ? '待同步' : '已保存在本机';
        this.persist();
    }
    stop() {
        this.cancelled = true;
        this.onChange = () => { };
    }
    run(work) {
        if (this.job)
            return this.job;
        this.job = work().finally(() => {
            this.job = null;
            this.notify();
        });
        return this.job;
    }
    async pull() {
        return this.run(async () => {
            if (!this.transport || this.cancelled)
                return;
            try {
                if (this.state.inflight) {
                    await this.send();
                    if (this.state.inflight || this.state.conflict)
                        return;
                }
                const remote = await this.transport.get(this.state.bookId, this.state.textRevision);
                if (this.cancelled)
                    return;
                if (this.state.version !== null && remote.version < this.state.version)
                    return;
                if (this.state.dirty &&
                    (this.state.version === null || remote.version !== this.state.version)) {
                    this.state.conflict = remote;
                    this.status = '请选择要保留的进度';
                }
                else if (!this.state.dirty) {
                    this.state.version = remote.version;
                    this.state.progress = remote.progress;
                    this.status = remote.progress ? '进度已同步' : '尚无阅读进度';
                }
                this.persist();
            }
            catch (e) {
                this.error(e);
            }
        });
    }
    flush() {
        return this.run(async () => {
            if (!this.transport || this.cancelled || this.state.conflict || this.state.deferred)
                return;
            try {
                if (this.now() - this.state.createdAt > 7 * 86400000 &&
                    (this.state.dirty || this.state.inflight)) {
                    const remote = await this.transport.get(this.state.bookId, this.state.textRevision);
                    if (this.cancelled)
                        return;
                    this.status = '进度已超过自动同步期限，请选择同步方案';
                    this.state.conflict = remote;
                    this.persist();
                    return;
                }
                if (this.state.inflight)
                    await this.send();
                if (this.state.inflight || this.state.conflict || this.cancelled)
                    return;
                if (this.state.version === null) {
                    const remote = await this.transport.get(this.state.bookId, this.state.textRevision);
                    if (this.cancelled)
                        return;
                    if (this.state.dirty) {
                        this.state.conflict = remote;
                        this.status = '请选择要保留的进度';
                        this.persist();
                        return;
                    }
                    this.state.version = remote.version;
                    this.state.progress = remote.progress;
                }
                if (!this.state.dirty || !this.state.progress)
                    return;
                const { bookId, updatedAt, ...progress } = this.state.progress;
                this.state.inflight = {
                    kind: 'put',
                    body: {
                        ...progress,
                        expectedVersion: this.state.version,
                        clientMutationId: this.uuid(),
                    },
                    revision: this.state.revision,
                };
                this.persist();
                await this.send();
            }
            catch (e) {
                this.error(e);
            }
        });
    }
    async send() {
        const sent = this.state.inflight;
        if (!sent || !this.transport)
            return;
        this.status = '正在同步';
        this.notify();
        let result;
        try {
            result = await (sent.kind === 'put'
                ? this.transport.put(this.state.bookId, sent.body)
                : this.transport.reset(this.state.bookId, sent.body));
        }
        catch (e) {
            // Only an explicit, definitive retirement error permits changing the source build.
            // Network uncertainty must replay the original immutable request first.
            if (sent.kind !== 'put' ||
                !['BUILD_RETIRED', 'BUILD_UPDATE_REQUIRED'].includes(e === null || e === void 0 ? void 0 : e.code) ||
                !this.transport.rebase)
                throw e;
            const body = await this.transport.rebase(this.state.bookId, sent.body);
            if (this.cancelled)
                return;
            if (!body)
                throw Error('正文版本已变化，旧进度保留在本机，请打开最新书籍');
            if (body.textRevision !== sent.body.textRevision ||
                body.expectedVersion !== sent.body.expectedVersion)
                throw Error('进度迁移不能改变正文版本或同步基线');
            this.state.inflight = { ...sent, body: { ...body, clientMutationId: this.uuid() } };
            this.persist();
            result = await this.transport.put(this.state.bookId, this.state.inflight.body);
        }
        if (this.cancelled)
            return;
        this.state.version = result.version;
        this.state.inflight = undefined;
        if (sent.kind === 'reset') {
            this.state.progress = null;
            this.state.dirty = false;
            this.state.resetting = false;
            this.state.revision++;
        }
        else if (this.state.revision === sent.revision) {
            this.state.progress = result.progress;
            this.state.dirty = false;
        }
        this.status = this.state.dirty ? '待同步' : sent.kind === 'reset' ? '进度已清除' : '进度已同步';
        this.persist();
    }
    error(e) {
        if (this.cancelled)
            return;
        if ((e === null || e === void 0 ? void 0 : e.code) === 'PROGRESS_CONFLICT') {
            this.state.conflict = e.details;
            this.state.inflight = undefined;
            this.status = '请选择要保留的进度';
        }
        else
            this.status = e instanceof Error ? e.message : '同步未完成';
        this.persist();
    }
    async choose(choice) {
        const c = this.state.conflict;
        if (!c)
            return;
        if (choice === 'later') {
            this.state.deferred = true;
            this.persist();
            return;
        }
        const wasResetting = this.state.resetting;
        this.state.version = c.version;
        this.state.inflight = undefined;
        this.state.conflict = undefined;
        this.state.deferred = false;
        this.state.createdAt = this.now();
        if (choice === 'cloud') {
            this.state.progress = c.progress;
            this.state.dirty = false;
            this.state.resetting = false;
            this.state.revision++;
            this.status = c.progress ? '进度已同步' : '云端已清除';
            this.persist();
        }
        else if (wasResetting) {
            this.state.resetting = false;
            await this.clear();
        }
        else {
            this.state.dirty = !!this.state.progress;
            this.persist();
            await this.flush();
        }
    }
    async clear() {
        while (this.job)
            await this.job;
        if (this.cancelled) return;
        return this.run(async () => {
            if (this.cancelled) return;
            var _a;
            this.state.resetting = true;
            this.state.deferred = false;
            this.state.conflict = undefined;
            this.persist();
            if (!this.transport) {
                this.state.progress = null;
                this.state.dirty = false;
                this.state.inflight = undefined;
                this.state.resetting = false;
                this.state.revision++;
                this.status = '本机进度已清除';
                this.persist();
                return;
            }
            try {
                const pendingReset = ((_a = this.state.inflight) === null || _a === void 0 ? void 0 : _a.kind) === 'reset';
                if (this.state.inflight)
                    await this.send();
                if (this.state.conflict || this.cancelled || pendingReset)
                    return;
                if (this.state.version === null) {
                    const r = await this.transport.get(this.state.bookId, this.state.textRevision);
                    if (this.cancelled)
                        return;
                    this.state.version = r.version;
                }
                this.state.dirty = false;
                this.state.inflight = {
                    kind: 'reset',
                    body: {
                        textRevision: this.state.textRevision,
                        expectedVersion: this.state.version,
                        clientMutationId: this.uuid(),
                    },
                    revision: this.state.revision,
                };
                this.persist();
                await this.send();
            }
            catch (e) {
                this.error(e);
            }
        });
    }
}
exports.SyncRecord = SyncRecord;
