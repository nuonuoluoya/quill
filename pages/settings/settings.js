const { auth, identity, login, logout } = require('../../models/auth');
const { selectedBook } = require('../../models/context');
const { defaultSpeed } = require('../../models/preferences');
const { content } = require('../../models/content');
const { progressStore } = require('../../models/progress');
const { player } = require('../../models/player');
const { speeds } = require('../../utils/contracts');
const { subscribe, emit } = require('../../utils/events');
const { environment, storage, confirm, message, toLibrary } = require('../../utils/http');
const { FULL_BOOK_ID } = require('../../utils/guest-preview');
const { cleanupState, clearAudio } = require('../../models/audio-cleanup');
const scopeKey = () => { const b = selectedBook.value; return JSON.stringify([identity(), auth.epoch, b?.bookId, b?.buildId, b?.textRevision]); };
const pendingProgress = r => !!(r.transport && (r.state.dirty || r.state.inflight));
const resetResult = (r, b) => {
    if (r.state.conflict) return '重置尚未完成，请处理进度冲突';
    if (r.state.resetting || r.state.inflight) return '重置尚未完成 · ' + progressStore.status(b);
    if (!r.saved) return '本机保存未完成，请重试';
    if (r.state.progress) return '';
    return auth.session ? '当前内容版本的本机与云端进度已重置' : '此设备上的游客进度已重置';
};
Page({
    data: { favoritesEnabled: true, loggedIn: false, consent: false, busy: false, error: '', book: null, position: '', status: '', speed: 1, speeds, hasReturnChapter: false, confirmKind: '', confirmTitle: '', confirmLoggedIn: false, confirmPending: false, confirmIsBook: false, audioBusy: false, audioResult: '', resetResult: '' },
    onLoad(q = {}) { this.alive = true; this.returnChapterId = q.returnBookId === FULL_BOOK_ID && typeof q.returnChapterId === 'string' ? q.returnChapterId : ''; this.setData({ hasReturnChapter: !!this.returnChapterId }); this.off = subscribe(() => this.refresh()); },
    onShow() { this.visible = true; this.refresh(); if (auth.session && this.returnChapterId && !this.returnAttempted) { this.returnAttempted = true; this.resumeRequested(); } },
    onHide() { this.visible = false; this.chapterRequest = (this.chapterRequest || 0) + 1; if (this.loginOperation) this.loginOperation.cancelled = true; if (!this.data.busy && !cleanupState.busy) this.cancelConfirm(); },
    onUnload() { this.alive = false; this.off(); },
    refresh() { if (!this.alive)
        return; const b = selectedBook.value, r = b ? progressStore.get(b) : null, p = r?.state.progress;
        if (this.data.confirmKind && this.confirmScope !== scopeKey()) { this.confirmScope = ''; this.setData({ confirmKind: '', error: '账号或当前内容已变化，请重新选择操作' }); }
        if (this.resetScope && this.resetScope !== scopeKey()) { this.resetScope = ''; this.setData({ resetResult: '' }); }
        if (this.resetScope && this.data.resetResult && r) this.setData({ resetResult: resetResult(r, b) });
        this.setData({ loggedIn: !!auth.session, book: b, position: p ? progressStore.position(b, p) : '尚未开始阅读', status: b ? progressStore.status(b) : '', speed: p ? p.preferredSpeed : defaultSpeed(), authError: auth.error,
            audioBusy: cleanupState.busy, audioResult: cleanupState.result, ...(this.data.confirmKind === 'reset' && r ? { confirmPending: pendingProgress(r) } : {}) }); },
    consent(e) { this.setData({ consent: e.detail.value.includes('agree') }); },
    experience() { this.returnChapterId = ''; this.chapterRequest = (this.chapterRequest || 0) + 1; if (this.loginOperation) this.loginOperation.cancelled = true; toLibrary(); },
    async openRequestedChapter(current = () => this.alive && this.visible !== false) {
        const id = this.returnChapterId, epoch = auth.epoch, owner = identity(), request = this.chapterRequest = (this.chapterRequest || 0) + 1;
        if (!id || !auth.session) return;
        const b = await content.book(FULL_BOOK_ID);
        if (!current() || this.chapterRequest !== request || this.returnChapterId !== id || !auth.session || auth.epoch !== epoch || identity() !== owner) return;
        if (!b.chapters.some(c => c.id === id)) throw Error('所选章节已不可用，请返回内容库刷新');
        wx.redirectTo({ url: '/pages/reader/reader?bookId=' + encodeURIComponent(b.bookId) + '&buildId=' + encodeURIComponent(b.buildId) + '&chapterId=' + encodeURIComponent(id) });
    },
    async resumeRequested() {
        if (this.data.busy) return;
        const request = (this.chapterRequest || 0) + 1;
        this.setData({ busy: true, error: '' });
        try { await this.openRequestedChapter(); }
        catch (e) { if (this.alive && this.visible !== false && this.chapterRequest === request) this.setData({ error: message(e) }); }
        finally { if (this.alive) this.setData({ busy: false }); }
    },
    async signIn() { if (!this.data.consent || this.data.busy)
        return; const oldBook = selectedBook.value, guest = oldBook && identity() === 'guest' ? progressStore.get(oldBook).state.progress : null;
        const operation = this.loginOperation = { cancelled: false };
        const pageCurrent = () => this.alive && this.visible !== false && this.loginOperation === operation && !operation.cancelled;
        let current = pageCurrent;
        this.setData({ busy: true, error: '' }); try {
        await login();
        if (!pageCurrent() || !auth.session) return;
        const owner = identity(), epoch = auth.epoch;
        let expectedBook = selectedBook.value;
        if (expectedBook && expectedBook !== oldBook) return;
        current = () => pageCurrent() && identity() === owner && auth.epoch === epoch && selectedBook.value === expectedBook;
        if (this.returnChapterId) { await this.openRequestedChapter(current); return; }
        if (oldBook) {
            const b = await content.book(oldBook.bookId);
            if (!current()) return;
            expectedBook = b;
            selectedBook.value = b;
            const r = progressStore.get(b);
            await r.pull();
            if (!current()) return;
            if (guest && guest.textRevision === b.textRevision) {
                const accepted = await confirm('保存游客阅读位置', '是否将本机游客位置用于此账号？若云端已有位置，会继续让你选择。', '选择进度');
                if (!current()) return;
                if (accepted) {
                    r.update(guest);
                    r.state.version = null;
                    await r.pull();
                }
            }
        }
    }
    catch (e) {
        if (current())
            this.setData({ error: message(e) });
    }
    finally {
        if (this.alive && this.loginOperation === operation) {
            this.loginOperation = null;
            this.setData({ busy: false });
            this.refresh();
        }
    } },
    setSpeed(e) { const speed = Number(e.currentTarget.dataset.value); player.setSpeed(speed); try {
        storage.set(`pidan:${environment}:${identity()}:speed`, speed);
    }
    catch (e) {
        this.setData({ error: '本机保存不可用' });
    } const b = this.data.book, p = b ? progressStore.get(b).state.progress : null; if (p)
        progressStore.update(b, { ...p, preferredSpeed: speed }); this.refresh(); },
    async sync() { const b = this.data.book; if (!b || this.data.busy)
        return; this.setData({ busy: true, error: '', resetResult: '' }); try {
        const r = progressStore.get(b);
        if (r.state.deferred) {
            r.state.deferred = false;
            emit();
        }
        else if (r.state.resetting && !r.state.conflict) {
            await r.clear();
        } else {
            await r.pull();
            await r.flush();
        }
    }
    catch (e) {
        this.setData({ error: message(e) });
    }
    finally {
        if (this.alive) {
            this.setData({ busy: false });
            this.refresh();
        }
    } },
    openAudio() {
        if (this.data.busy || cleanupState.busy) return;
        this.confirmScope = scopeKey(); this.setData({ confirmKind: 'audio', error: '' });
    },
    clear() {
        if (this.data.busy || cleanupState.busy) return;
        const b = selectedBook.value;
        if (!b) { this.setData({ error: '先选择要重置的内容' }); return; }
        const r = progressStore.get(b);
        if (r.state.resetting) { this.setData({ error: '重置尚未完成，请通过同步继续处理' }); return; }
        this.confirmScope = scopeKey();
        this.setData({ confirmKind: 'reset', confirmTitle: b.title, confirmLoggedIn: !!auth.session,
            confirmIsBook: !b.contentType || b.contentType === 'book', confirmPending: pendingProgress(r), error: '', resetResult: '' });
    },
    cancelConfirm() { if (this.data.busy || cleanupState.busy) return; this.confirmScope = ''; this.setData({ confirmKind: '' }); },
    async confirmAction() {
        if (this.data.busy || cleanupState.busy || !this.data.confirmKind) return;
        const scope = this.confirmScope;
        if (scope !== scopeKey()) { this.refresh(); return; }
        if (this.data.confirmKind === 'audio') {
            await clearAudio();
            if (this.alive) { this.setData({ confirmKind: '' }); this.refresh(); }
            return;
        }
        const b = selectedBook.value; if (!b) return;
        const r = progressStore.get(b);
        if (pendingProgress(r) && !this.data.confirmPending) { this.setData({ confirmPending: true }); return; }
        this.resetScope = scope; this.setData({ busy: true, error: '', resetResult: '' });
        try {
            player.dispose();
            await r.clear();
            if (!this.alive || scope !== scopeKey()) return;
            if (!r.state.conflict && !r.state.resetting && !r.state.inflight && !r.state.progress && r.saved)
                progressStore.forgetRecent(b.bookId);
            this.setData({ resetResult: resetResult(r, b) });
        } catch (e) { if (this.alive && scope === scopeKey()) this.setData({ error: message(e) }); }
        finally { if (this.alive) { this.setData({ busy: false, confirmKind: '' }); this.refresh(); } }
    },
    about() { wx.showModal({ title: '关于 Pidan Vocal', content: '英语听读与逐句练习。支持章节阅读、全文播放和学习进度同步。', showCancel: false }); },
    async exit() { if (progressStore.hasPending() && !await confirm('有进度尚未同步', '退出将清理此账号的本机缓存和未同步变更，云端已保存的进度会保留。', '退出登录'))
        return; await logout(); selectedBook.value = null; toLibrary(); }
});
