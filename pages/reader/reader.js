const { content, checkBook } = require('../../models/content');
const { api, onIdentityChange } = require('../../models/auth');
const { player, playerState } = require('../../models/player');
const { progressStore } = require('../../models/progress');
const { selectedBook } = require('../../models/context');
const { defaultSpeed } = require('../../models/preferences');
const { searchSentences, playable } = require('../../utils/contracts');
const { subscribe } = require('../../utils/events');
const { message } = require('../../utils/http');
const { catalog, unitTitle, seasonIdAt } = require('../../utils/catalog');
Page({
    data: { chapterLabel: '章节', chapterOptions: [], seasons: [], selectedSeasonId: '', seasonIndex: 0, catalogLabel: '章节', unitLabel: '章', isTv: false, chapterMode: false, offline: false, book: null, chapter: null, title: '听力阅读', rows: [], query: '', target: '', sheet: false, error: '', notice: '', updated: false, busy: true, frozen: false, hiddenCurrent: false, status: '', more: false },
    onLoad(q) { this.bookId = q.bookId || ''; this.buildId = q.buildId || ''; this.chapterId = q.chapterId || ''; this.sentenceId = q.sentenceId || ''; this.alive = true; this.networkChange = e => { if (this.alive) this.setData({ offline: !e.isConnected }); }; if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(this.networkChange); if (wx.getNetworkType) wx.getNetworkType({ success: e => this.networkChange({ isConnected: e.networkType !== 'none' }) }); this.active = true; this.epoch = 0; this.limit = 40; this.userScrolled = false; this.off = subscribe(() => this.refresh()); this.identityOff = onIdentityChange(() => { this.epoch++; player.dispose(); this.setData({ book: null, chapter: null, rows: [] }); this.load(); }); this.load(); },
    onShow() { this.active = true; player.setForeground(true); this.checkAccess(); clearInterval(this.timer); this.timer = setInterval(() => this.checkAccess(), 60000); },
    onHide() { this.active = false; player.setForeground(false); progressStore.flushAll(); clearInterval(this.timer); },
    onUnload() { this.alive = false; if (wx.offNetworkStatusChange) wx.offNetworkStatusChange(this.networkChange); this.epoch++; clearInterval(this.timer); this.off(); this.identityOff(); player.onSelection = () => { }; player.dispose(); progressStore.flushAll(); },
    refresh() {
        if (!this.alive || !this.data.book || !this.data.chapter)
            return;
        const c = this.data.chapter;
        const s = playerState;
        const filtered = searchSentences(c.sentences, this.data.query);
        const current = c.sentences[s.index];
        const frozen = !!progressStore.get(this.data.book).state.resetting;
        // 时间进度只更新播放器组件；正文只在选句/搜索等变化时更新。
        const key = [this.epoch, this.data.query, this.limit, s.index, s.mode, s.status, frozen, progressStore.status(this.data.book)].join('|');
        if (key === this.renderKey)
            return;
        this.renderKey = key;
        this.setData({ chapterMode: s.mode === 'chapter', rows: filtered.slice(0, this.limit).map(item => ({ ...item, number: String(item.index).padStart(3, '0'), available: playable(item), reason: (item.alignment.reasons || []).join(' · '), selected: s.mode === 'sentence' && item.index - 1 === s.index, playing: s.status === 'playing' && item.index - 1 === s.index })), more: filtered.length > this.limit, hiddenCurrent: s.mode === 'sentence' && !!current && !filtered.some(x => x.id === current.id), frozen, status: progressStore.status(this.data.book) });
    },
    save(index = playerState.index) { const b = this.data.book, c = this.data.chapter; if (!b || !c || progressStore.get(b).state.resetting)
        return; const s = c.sentences[index]; if (!s)
        return; progressStore.update(b, { bookId: b.bookId, textRevision: b.textRevision, sourceBuildId: b.buildId, chapterId: c.chapterId, sentenceId: s.id, preferredSpeed: playerState.speed, updatedAt: new Date().toISOString() }, s.index); },
    async load(newest = false) { const op = ++this.epoch; player.dispose(); this.limit = 40; this.renderKey = ''; this.setData({ busy: true, error: '', notice: '', query: '', chapter: null, rows: [] }); try {
        const b = this.buildId && !newest ? await api('/books/' + encodeURIComponent(this.bookId) + '/builds/' + encodeURIComponent(this.buildId)).then(checkBook) : await content.book(this.bookId);
        const id = b.chapters.some(c => c.id === this.chapterId) ? this.chapterId : (b.chapters.find(c => c.sentenceCount > 0) || b.chapters[0] || {}).id;
        if (!id)
            throw Error('本书暂无章节');
        const c = await content.chapter(b, id);
        if (!this.alive || op !== this.epoch)
            return;
        this.buildId = b.buildId;
        this.chapterId = id;
        selectedBook.value = b;
        let index = this.sentenceId ? c.sentences.findIndex(s => s.id === this.sentenceId) : 0;
        const notice = index < 0 ? '原句子不在当前正文中，已定位章节开头。' : '';
        index = Math.max(0, index);
        const { chapters: chapterOptions, ...navigation } = catalog(b, '', id);
        this.setData({ ...navigation, chapterLabel: unitTitle(b, id), chapterOptions, book: b, chapter: c, title: b.chapters.find(x => x.id === id).title, updated: false, notice });
        player.load(b, c, index);
        player.setForeground(this.active);
        const p = progressStore.get(b).state.progress;
        player.setSpeed(p ? p.preferredSpeed : defaultSpeed());
        player.onSelection = i => { this.save(i); if (!this.userScrolled)
            this.locate(); };
        this.refresh();
        this.locate();
    }
    catch (e) {
        if (this.alive && op === this.epoch)
            this.setData({ error: message(e), chapter: null, rows: [] });
    }
    finally {
        if (this.alive && op === this.epoch)
            this.setData({ busy: false });
    } },
    async checkAccess() { const b = this.data.book, op = this.epoch; if (!b || !this.alive || !this.active)
        return; try {
        await content.snapshot(b);
        const latest = await content.book(b.bookId);
        if (this.alive && op === this.epoch)
            this.setData({ updated: latest.buildId !== b.buildId });
    }
    catch (e) {
        if (this.alive && op === this.epoch && ['BOOK_FORBIDDEN', 'BUILD_REVOKED', 'BUILD_RETIRED', 'SESSION_EXPIRED', 'STALE_IDENTITY'].includes(e.code)) {
            player.dispose();
            content.clear();
            this.setData({ chapter: null, rows: [], error: message(e) });
        }
    } },
    async updateContent() { const b = this.data.book; if (!b)
        return; try {
        const latest = await content.book(b.bookId);
        const c = this.data.chapter;
        this.sentenceId = latest.textRevision === b.textRevision && c && c.sentences[playerState.index] ? c.sentences[playerState.index].id : '';
        if (latest.textRevision !== b.textRevision)
            this.chapterId = '';
        this.buildId = '';
        await this.load(true);
        if (latest.textRevision !== b.textRevision)
            this.setData({ notice: '正文版本已更新，旧版进度独立保留。' });
    }
    catch (e) {
        this.setData({ notice: message(e) });
    } },
    search(e) { this.limit = 40; this.setData({ query: e.detail.value }); this.refresh(); },
    more() { this.limit += 40; this.refresh(); },
    manualScroll() { this.userScrolled = true; },
    locate() { this.userScrolled = false; this.limit = Math.max(this.limit, playerState.index + 15); this.setData({ query: '', target: '' }); this.refresh(); wx.nextTick(() => { if (this.alive)
        this.setData({ target: 'sentence-' + playerState.index }); }); },
    click(e) { if (this.data.frozen)
        return; player.clickSentence(Number(e.currentTarget.dataset.index) - 1); },
    changeSpeed() { this.save(); },
    showChapters() { if (!this.data.book || !this.data.chapter) return; const { chapters: chapterOptions, ...navigation } = catalog(this.data.book, '', this.data.chapter.chapterId); this.setData({ ...navigation, chapterOptions, sheet: true }); },
    changeSeason(e) { const id = seasonIdAt(this.data.seasons, e.detail.value); if (!id || !this.data.book) return; const { chapters: chapterOptions, ...navigation } = catalog(this.data.book, id); this.setData({ ...navigation, chapterOptions }); },
    hideChapters() { this.setData({ sheet: false }); },
    async chooseChapter(e) { const id = e.currentTarget.dataset.id; if (!this.data.book || !this.data.book.chapters.some(c => c.id === id)) return; this.setData({ sheet: false }); if (this.data.chapter && this.data.chapter.chapterId === id) return; this.chapterId = id; this.sentenceId = ''; const op = this.epoch + 1; await this.load(); if (this.alive && this.epoch === op && this.data.chapter && this.data.chapter.chapterId === id)
        this.save(); },
    fullPlay() { if (!this.data.frozen)
        player.chapterPlay(); },
    retry() { this.buildId = ''; this.load(true); },
    async resolved() { const b = this.data.book; if (!b)
        return; const r = progressStore.get(b); if (r.state.deferred)
        return; player.pause(); const p = r.state.progress; if (p && p.chapterId !== this.chapterId) {
        this.chapterId = p.chapterId;
        this.sentenceId = p.sentenceId;
        await this.load();
        return;
    } const c = this.data.chapter; if (!c)
        return; const index = p ? c.sentences.findIndex(s => s.id === p.sentenceId) : 0; const callback = player.onSelection; player.onSelection = () => { }; player.select(Math.max(0, index), false); player.setSpeed(p ? p.preferredSpeed : 1); player.onSelection = callback; this.locate(); }
});
