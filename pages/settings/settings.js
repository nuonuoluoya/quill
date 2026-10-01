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
Page({
    data: { loggedIn: false, consent: false, busy: false, error: '', book: null, position: '', status: '', speed: 1, speeds, hasReturnChapter: false },
    onLoad(q = {}) { this.alive = true; this.returnChapterId = q.returnBookId === FULL_BOOK_ID && typeof q.returnChapterId === 'string' ? q.returnChapterId : ''; this.setData({ hasReturnChapter: !!this.returnChapterId }); this.off = subscribe(() => this.refresh()); },
    onShow() { this.refresh(); if (auth.session && this.returnChapterId && !this.returnAttempted) { this.returnAttempted = true; this.resumeRequested(); } },
    onUnload() { this.alive = false; this.off(); },
    refresh() { if (!this.alive)
        return; const b = selectedBook.value, p = b ? progressStore.get(b).state.progress : null; this.setData({ loggedIn: !!auth.session, book: b, position: p ? progressStore.position(b, p) : '尚未开始阅读', status: b ? progressStore.status(b) : '', speed: p ? p.preferredSpeed : defaultSpeed(), authError: auth.error }); },
    consent(e) { this.setData({ consent: e.detail.value.includes('agree') }); },
    experience() { this.returnChapterId = ''; toLibrary(); },
    async openRequestedChapter() {
        const id = this.returnChapterId;
        if (!id || !auth.session) return;
        const b = await content.book(FULL_BOOK_ID);
        if (!this.alive || this.returnChapterId !== id) return;
        if (!b.chapters.some(c => c.id === id)) throw Error('所选章节已不可用，请返回内容库刷新');
        wx.redirectTo({ url: '/pages/reader/reader?bookId=' + encodeURIComponent(b.bookId) + '&buildId=' + encodeURIComponent(b.buildId) + '&chapterId=' + encodeURIComponent(id) });
    },
    async resumeRequested() {
        if (this.data.busy) return;
        this.setData({ busy: true, error: '' });
        try { await this.openRequestedChapter(); }
        catch (e) { if (this.alive) this.setData({ error: message(e) }); }
        finally { if (this.alive) this.setData({ busy: false }); }
    },
    async signIn() { if (!this.data.consent || this.data.busy)
        return; const oldBook = selectedBook.value, guest = oldBook && identity() === 'guest' ? progressStore.get(oldBook).state.progress : null; this.setData({ busy: true, error: '' }); try {
        await login();
        if (!this.alive) return;
        if (this.returnChapterId) { await this.openRequestedChapter(); return; }
        if (oldBook) {
            const b = await content.book(oldBook.bookId);
            selectedBook.value = b;
            const r = progressStore.get(b);
            await r.pull();
            if (guest && guest.textRevision === b.textRevision && await confirm('保存游客阅读位置', '是否将本机游客位置用于此账号？若云端已有位置，会继续让你选择。', '选择进度')) {
                r.update(guest);
                r.state.version = null;
                await r.pull();
            }
        }
    }
    catch (e) {
        if (this.alive)
            this.setData({ error: message(e) });
    }
    finally {
        if (this.alive) {
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
        return; this.setData({ busy: true, error: '' }); try {
        const r = progressStore.get(b);
        if (r.state.deferred) {
            r.state.deferred = false;
            emit();
        }
        else {
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
    async clear() { const b = this.data.book; if (!b || this.data.busy)
        return; if (!await confirm('清除本书当前正文版本进度', `《${b.title}》\n正文版本：${b.textRevision}\n${auth.session ? '此账号所有设备' : '本机'}的位置与速度偏好将被清除，其他书籍和正文版本不受影响。无法撤销。`, '清除进度'))
        return; this.setData({ busy: true }); player.dispose(); try {
        const r = progressStore.get(b);
        await r.clear();
        if (!r.state.resetting && !r.state.conflict)
            progressStore.forgetRecent(b.bookId);
    }
    finally {
        if (this.alive) {
            this.setData({ busy: false });
            this.refresh();
        }
    } },
    about() { wx.showModal({ title: '关于 Pidan Vocal', content: '英语听读与逐句练习。支持章节阅读、全文播放和学习进度同步。', showCancel: false }); },
    async exit() { if (progressStore.hasPending() && !await confirm('有进度尚未同步', '退出将清理此账号的本机缓存和未同步变更，云端已保存的进度会保留。', '退出登录'))
        return; await logout(); selectedBook.value = null; toLibrary(); }
});
