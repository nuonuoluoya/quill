const { content, checkBook } = require('../../models/content');
const { api, onIdentityChange } = require('../../models/auth');
const { player, playerState } = require('../../models/player');
const { progressStore } = require('../../models/progress');
const { selectedBook } = require('../../models/context');
const { defaultSpeed } = require('../../models/preferences');
const { searchSentences, playable } = require('../../utils/contracts');
const { subscribe } = require('../../utils/events');
const { message, navigate } = require('../../utils/http');
const { lockedChapterLogin } = require('../../utils/guest-preview');
const { catalog, unitTitle, seasonIdAt } = require('../../utils/catalog');
const { episodeFor } = require('../../utils/podcast');
const { identity } = require('../../models/auth');
const { shadowing, shadowState } = require('../../models/shadowing');
const { cleanupState } = require('../../models/audio-cleanup');
const { favorites } = require('../../models/favorites');
const { favoriteId, reference } = require('../../utils/favorites');
Page({
    data: { scrollEpoch: 0, openedId: '', pendingFavorite: '', favoriteError: '', favoriteFrozen: false, chapterLabel: '章节', chapterOptions: [], seasons: [], selectedSeasonId: '', seasonIndex: 0, catalogLabel: '章节', unitLabel: '章', isTv: false, isPodcast: false, chapterMode: false, offline: false, book: null, chapter: null, title: '听力阅读', rows: [], query: '', target: '', sheet: false, error: '', notice: '', updated: false, busy: true, frozen: false, hiddenCurrent: false, status: '', more: false },
    onLoad(q) { this.bookId = q.bookId || ''; this.buildId = q.buildId || ''; this.chapterId = q.chapterId || ''; this.sentenceId = q.sentenceId || ''; this.alive = true; this.networkChange = e => { if (this.alive) this.setData({ offline: !e.isConnected }); }; if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(this.networkChange); if (wx.getNetworkType) wx.getNetworkType({ success: e => this.networkChange({ isConnected: e.networkType !== 'none' }) }); this.active = true; this.epoch = 0; this.limit = 40; this.userScrolled = false; this.off = subscribe(() => this.refresh()); this.identityOff = onIdentityChange(() => { this.epoch++; if (this.ownsPlayer()) { shadowing.reset(); player.dispose(); } this.setData({ book: null, chapter: null, rows: [], openedId: '', pendingFavorite: '', favoriteError: '' }); if (this.active) this.load(); else this.needsIdentityLoad = true; }); this.load(); },
    onShow() { this.active = true; if (this.needsIdentityLoad) { this.needsIdentityLoad = false; this.load(); } else if (this.data.book && this.data.chapter) { if (!this.ownsPlayer()) { player.load(this.data.book, this.data.chapter, this.resumeIndex || 0); player.onEnded = null; this.bindSelection(); } this.refreshFavorites(); this.renderKey = ''; this.refresh(); } shadowing.resume(); player.setForeground(true); this.checkAccess(); clearInterval(this.timer); this.timer = setInterval(() => this.checkAccess(), 60000); },
    onHide() { if (this.ownsPlayer()) this.resumeIndex = playerState.index; this.favoriteRequest = (this.favoriteRequest || 0) + 1; this.favoriteWrite = (this.favoriteWrite || 0) + 1; this.setData({ openedId: '', pendingFavorite: '' }); this.active = false; this.updateRequest = (this.updateRequest || 0) + 1; if (this.updateLoadEpoch === this.epoch && this.data.busy) { this.epoch++; this.updateLoadEpoch = null; this.setData({ busy: false, error: '内容更新已取消，请重试' }); } else if (this.data.busy) { this.epoch++; this.needsIdentityLoad = true; this.setData({ busy: false }); } if (this.ownsPlayer()) { shadowing.interrupt(); player.setForeground(false); } progressStore.flushAll(); clearInterval(this.timer); },
    onUnload() { const owns = this.ownsPlayer(); this.alive = false; this.active = false; if (owns) { shadowing.reset(); player.onSelection = () => {}; player.onEnded = null; player.dispose(); } if (wx.offNetworkStatusChange) wx.offNetworkStatusChange(this.networkChange); this.epoch++; clearInterval(this.timer); this.off(); this.identityOff(); progressStore.flushAll(); },
    ownsPlayer() { return player.onSelection === this.selection && !!this.selection; },
    bindSelection() { this.selection = i => { if (!this.active || !this.alive || !this.ownsPlayer()) return; this.closeFavorite(); this.resumeIndex = i; this.save(i); if (!this.userScrolled) this.locate(); }; player.onSelection = this.selection; },
    async refreshFavorites(retried = false) {
        const b = this.data.book, c = this.data.chapter, epoch = this.epoch;
        if (!b || !c || !this.active) return;
        const request = this.favoriteRequest = (this.favoriteRequest || 0) + 1;
        const current = () => this.alive && this.active && this.epoch === epoch && this.favoriteRequest === request && this.data.chapter === c;
        this.setData({ favoriteError: '' });
        try { await favorites.status(b,c); if (current()) { this.favoriteRender = (this.favoriteRender || 0) + 1; this.refresh(); } }
        catch (e) { if (current()) { if (e.code === 'FAVORITES_CHANGED' && retried !== true) return this.refreshFavorites(true); this.setData({ favoriteError: '收藏状态读取失败 · 点击重试' }); this.favoriteRender = (this.favoriteRender || 0) + 1; this.refresh(); } }
    },
    revealFavorite(e) { if (!this.data.frozen && !shadowState.open && !(e.detail.open && this.rowsScrolling)) this.setData({ openedId: e.detail.open ? e.detail.id : '' }); },
    closeFavorite() { if (this.data.openedId) this.setData({ openedId: '' }); },
    playRow(e) { this.click({ currentTarget:{ dataset:{ index:e.detail.index } } }); },
    async changeFavorite(e) {
        if (!this.active || this.data.frozen || shadowState.open || this.data.pendingFavorite) return;
        const b = this.data.book, c = this.data.chapter, sentence = c?.sentences.find(s=>s.id===e.detail.id);
        if (!sentence) return;
        const state = favorites.states.get(favoriteId(reference(b,c,sentence)));
        if (!state) { this.refreshFavorites(); return; }
        const epoch = this.epoch, request = this.favoriteWrite = (this.favoriteWrite || 0) + 1;
        const current = () => this.alive && this.active && this.epoch === epoch && this.favoriteWrite === request;
        this.setData({ pendingFavorite:sentence.id,favoriteError:'' });
        try { await favorites.set(b,c,sentence,!state.saved); if (current()) { this.setData({openedId:''}); await this.refreshFavorites(); } }
        catch (e) { if (current()) { if (e.code === 'FAVORITES_CHANGED') await this.refreshFavorites(); if (current()) this.setData({favoriteError:message(e)}); } }
        finally { if (current()) { this.setData({pendingFavorite:''}); this.refresh(); } }
    },
    refresh() {
        if (!this.alive || !this.active || !this.data.book || !this.data.chapter || !this.ownsPlayer())
            return;
        const c = this.data.chapter;
        const s = playerState;
        const filtered = searchSentences(c.sentences, this.data.query);
        const current = c.sentences[s.index];
        if (shadowState.open && (shadowing.target?.sentence.id !== current?.id || shadowing.target?.chapter.chapterId !== c.chapterId || s.mode !== 'sentence')) shadowing.close();
        const frozen = !!progressStore.get(this.data.book).state.resetting || cleanupState.busy;
        // 时间进度只更新播放器组件；正文只在选句/搜索等变化时更新。
        const key = [this.epoch, this.data.query, this.limit, s.index, s.mode, s.status, frozen, shadowState.open, favorites.revision, this.favoriteRender, progressStore.status(this.data.book)].join('|');
        if (key === this.renderKey)
            return;
        this.renderKey = key;
        this.setData({ favoriteFrozen: shadowState.open, chapterMode: s.mode === 'chapter', rows: filtered.slice(0, this.limit).map(item => { const saved = favorites.states.get(favoriteId(reference(this.data.book,c,item))); return { ...item, saved: saved?.saved === true, favoriteKnown: !!saved, number: String(item.index).padStart(3, '0'), available: playable(item), reason: (item.alignment.reasons || []).join(' · '), selected: s.mode === 'sentence' && item.index - 1 === s.index, playing: s.status === 'playing' && item.index - 1 === s.index }; }), more: filtered.length > this.limit, hiddenCurrent: s.mode === 'sentence' && !!current && !filtered.some(x => x.id === current.id), frozen, status: progressStore.status(this.data.book) });
    },
    save(index = playerState.index) { const b = this.data.book, c = this.data.chapter; if (!this.active || !this.ownsPlayer() || !b || !c || progressStore.get(b).state.resetting)
        return; const s = c.sentences[index]; if (!s)
        return; progressStore.update(b, { bookId: b.bookId, textRevision: b.textRevision, sourceBuildId: b.buildId, chapterId: c.chapterId, sentenceId: s.id, preferredSpeed: playerState.speed, updatedAt: new Date().toISOString() }, s.index); },
    async load(newest = false, current = () => true) { if (!this.alive || !this.active || !current()) return; const op = ++this.epoch; shadowing.close(); player.dispose(); this.limit = 40; this.renderKey = ''; this.setData({ openedId: '', pendingFavorite: '', favoriteError: '', busy: true, error: '', notice: '', query: '', chapter: null, rows: [] }); try {
        const b = this.buildId && !newest ? await api('/books/' + encodeURIComponent(this.bookId) + '/builds/' + encodeURIComponent(this.buildId)).then(checkBook) : await content.book(this.bookId);
        if (!this.alive || op !== this.epoch || !this.active || !current()) return;
        const id = b.chapters.some(c => c.id === this.chapterId) ? this.chapterId : (b.chapters.find(c => c.sentenceCount > 0) || b.chapters[0] || {}).id;
        if (!id)
            throw Error('本书暂无章节');
        const c = await content.chapter(b, id);
        if (!this.alive || op !== this.epoch || !this.active || !current())
            return;
        this.buildId = b.buildId;
        this.chapterId = id;
        selectedBook.value = b;
        let index = this.sentenceId ? c.sentences.findIndex(s => s.id === this.sentenceId) : 0;
        const notice = index < 0 ? '原句子不在当前正文中，已定位章节开头。' : '';
        index = Math.max(0, index);
        const { chapters: chapterOptions, ...navigation } = catalog(b, '', id);
        const episode = b.contentType === 'podcast' ? episodeFor(b, id) : null;
        this.setData({ ...navigation, chapterLabel: b.contentType === 'book' ? '第 ' + (b.chapters.findIndex(x => x.id === id) + 1) + ' 章' : unitTitle(b, id), chapterOptions, book: b, chapter: c, title: episode ? episode.title : b.chapters.find(x => x.id === id).title, updated: false, notice });
        player.load(b, c, index);
        player.onEnded = null;
        player.setForeground(this.active);
        const p = progressStore.get(b).state.progress;
        player.setSpeed(p ? p.preferredSpeed : defaultSpeed());
        this.bindSelection();
        this.refreshFavorites();
        this.refresh();
        this.locate();
    }
    catch (e) {
        if (this.alive && op === this.epoch && current())
            this.setData({ error: message(e), chapter: null, rows: [] });
    }
    finally {
        if (this.alive && this.active && op === this.epoch)
            this.setData({ busy: false });
    } },
    async checkAccess() { const b = this.data.book, op = this.epoch; if (!b || !this.alive || !this.active)
        return; try {
        await content.snapshot(b);
        const latest = await content.book(b.bookId);
        if (this.alive && this.active && op === this.epoch && this.data.updated !== (latest.buildId !== b.buildId))
            this.setData({ updated: latest.buildId !== b.buildId });
    }
    catch (e) {
        if (this.alive && this.active && op === this.epoch && ['BOOK_FORBIDDEN', 'BUILD_REVOKED', 'BUILD_RETIRED', 'SESSION_EXPIRED', 'STALE_IDENTITY'].includes(e.code)) {
            shadowing.reset();
            player.dispose();
            content.clear();
            this.setData({ chapter: null, rows: [], error: message(e) });
        }
    } },
    async updateContent() { const b = this.data.book; if (!b || !this.alive || !this.active)
        return; const epoch = this.epoch, request = this.updateRequest = (this.updateRequest || 0) + 1;
        const current = () => this.alive && this.active && this.epoch === epoch && this.updateRequest === request && this.data.book === b;
        try {
        const latest = await content.book(b.bookId);
        if (!current()) return;
        const c = this.data.chapter;
        this.sentenceId = latest.textRevision === b.textRevision && c && c.sentences[playerState.index] ? c.sentences[playerState.index].id : '';
        if (latest.textRevision !== b.textRevision)
            this.chapterId = '';
        this.buildId = '';
        const loadingEpoch = this.epoch + 1;
        this.updateLoadEpoch = loadingEpoch;
        await this.load(true, () => this.active && this.updateRequest === request);
        if (this.updateLoadEpoch === loadingEpoch) this.updateLoadEpoch = null;
        if (this.alive && this.active && this.epoch === loadingEpoch && this.updateRequest === request && this.data.chapter && !this.data.error && latest.textRevision !== b.textRevision)
            this.setData({ notice: '正文版本已更新，旧版进度独立保留。' });
    }
    catch (e) {
        if (current()) this.setData({ notice: message(e) });
    } },
    search(e) { this.closeFavorite(); this.limit = 40; this.setData({ query: e.detail.value }); this.refresh(); },
    more() { this.limit += 40; this.refresh(); },
    manualScroll() { this.userScrolled = true; this.rowsScrolling = false; },
    scrollRows() { if (!this.rowsScrolling) { this.rowsScrolling = true; this.setData({ scrollEpoch: this.data.scrollEpoch + 1 }); } this.closeFavorite(); },
    locate() { this.userScrolled = false; this.limit = Math.max(this.limit, playerState.index + 15); this.setData({ query: '', target: '' }); this.refresh(); wx.nextTick(() => { if (this.alive)
        this.setData({ target: 'sentence-' + playerState.index }); }); },
    click(e) { if (this.data.frozen || shadowState.open) return;
        const index = Number(e.currentTarget.dataset.index) - 1;
        if (!this.data.chapter?.sentences[index]) return;
        this.closeFavorite(); player.clickSentence(index); },
    changeSpeed() { this.save(); },
    openShadowing() {
        if (this.data.frozen || playerState.mode !== 'sentence' || !this.data.book || !this.data.chapter) return;
        const sentence = this.data.chapter.sentences[playerState.index];
        if (sentence) shadowing.open({ owner: identity(), book: this.data.book, chapter: this.data.chapter, sentence, speed: playerState.speed });
    },
    showChapters() { this.closeFavorite(); if (!this.data.book || !this.data.chapter) return; const { chapters: chapterOptions, ...navigation } = catalog(this.data.book, '', this.data.chapter.chapterId); this.setData({ ...navigation, chapterOptions, sheet: true }); },
    changeSeason(e) { const id = seasonIdAt(this.data.seasons, e.detail.value); if (!id || !this.data.book) return; const { chapters: chapterOptions, ...navigation } = catalog(this.data.book, id); this.setData({ ...navigation, chapterOptions }); },
    hideChapters() { this.setData({ sheet: false }); },
    choosePart(e) { return this.chooseChapter({ currentTarget: { dataset: { id: e.detail.chapterId } } }); },
    async chooseChapter(e) { const id = e.currentTarget.dataset.id; const loginUrl = lockedChapterLogin(this.data.book, id); if (loginUrl) { this.setData({ sheet: false }); navigate(loginUrl); return; } if (!this.data.book || !this.data.book.chapters.some(c => c.id === id)) return; this.setData({ sheet: false }); if (this.data.chapter && this.data.chapter.chapterId === id) return; this.chapterId = id; this.sentenceId = ''; const op = this.epoch + 1; await this.load(); if (this.alive && this.epoch === op && this.data.chapter && this.data.chapter.chapterId === id)
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
