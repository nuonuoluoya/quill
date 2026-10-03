// Only SDK-returned, registered audio files are owned by this registry.
class AudioFiles {
    constructor(ports) {
        this.ports = ports; this.paths = new Set(); this.removing = new Map(); this.leases = new Set();
        this.deleted = 0; this.saved = true; this.readable = true;
        try {
            const old = ports.load();
            if (old !== undefined && old !== null && old !== '') {
                if (old.schema !== 1 || !Array.isArray(old.paths) || old.paths.some(p => !ports.valid(p))) throw Error('Invalid audio index');
                old.paths.forEach(p => this.paths.add(p));
            }
        } catch { this.readable = false; }
    }
    persist() {
        if (!this.readable) return;
        try { this.ports.save({ schema: 1, paths: [...this.paths] }); this.saved = true; }
        catch { this.saved = false; }
    }
    track(path) {
        if (!this.ports.valid(path)) { if (path) this.unmanaged = true; return false; }
        if (!this.paths.has(path)) { this.paths.add(path); this.persist(); }
        return true;
    }
    begin() { const token = {}; this.leases.add(token); return () => this.leases.delete(token); }
    remove(path) {
        if (!this.track(path)) return Promise.resolve(false);
        if (this.removing.has(path)) return this.removing.get(path);
        const job = Promise.resolve().then(() => this.ports.unlink(path)).then(result => {
            this.paths.delete(path); if (result !== 'missing') this.deleted++;
            this.persist(); return true;
        }, () => false).finally(() => this.removing.delete(path));
        this.removing.set(path, job); return job;
    }
    async settle(timeout) {
        const end = Date.now() + timeout;
        while (this.leases.size || this.removing.size) {
            if (Date.now() >= end) return false;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        return true;
    }
    clear(stop, timeout = 15000) {
        if (this.job) return this.job;
        const deleted = this.deleted;
        this.job = Promise.resolve().then(async () => {
            let stopped = true;
            try { stop(); } catch { stopped = false; }
            const settled = await this.settle(timeout);
            if (stopped && settled) await Promise.all([...this.paths].map(path => this.remove(path)));
            this.persist();
            const failed = !stopped || !settled || !this.readable || !this.saved || this.unmanaged || this.paths.size > 0;
            const removed = this.deleted - deleted;
            return failed ? (removed ? 'partial' : 'failed') : removed ? 'success' : 'empty';
        }).catch(() => 'failed').finally(() => { this.job = null; });
        return this.job;
    }
}
module.exports = { AudioFiles };
