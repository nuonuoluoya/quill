const { content } = require('../../models/content');
const { selectedBook } = require('../../models/context');
const { progressStore } = require('../../models/progress');
const { subscribe } = require('../../utils/events');
const { onIdentityChange } = require('../../models/auth');
const { navigate, message } = require('../../utils/http');
const { catalog, seasonIdAt } = require('../../utils/catalog');
const { lockedChapterLogin } = require('../../utils/guest-preview');
Page({
    data: { book: null, chapters: [], isPodcast: false, podcastChapterId: '', seasons: [], selectedSeasonId: '', seasonIndex: 0, unitLabel: '章', catalogLabel: '章节', catalogSummary: '', busy: true, error: '', position: '', status: '', totals: [0, 0] },
    onLoad(q) { this.id = q.bookId || ''; this.continueRequested = q.continue === '1'; this.alive = true; this.epoch = 0; this.seasonChoice = ''; this.off = subscribe(() => this.refresh()); this.identityOff = onIdentityChange(() => { this.epoch++; this.seasonChoice = ''; this.setData({ book: null, chapters: [], seasons: [], selectedSeasonId: '', position: '' }); this.load(); }); this.load(); },
    onShow() { if (this.data.book)
        this.load(); },
    onUnload() { this.alive = false; this.epoch++; this.off(); this.identityOff(); },
    refresh() { const b = this.data.book; if (!b || !this.alive)
        return; const p = progressStore.get(b).state.progress; this.setData({ podcastChapterId: p ? p.chapterId : '', position: p ? progressStore.position(b, p) : '', status: progressStore.status(b) }); },
    async load() { const op = ++this.epoch; this.setData({ busy: true, error: '' }); try {
        const b = await content.book(this.id);
        if (!this.alive || op !== this.epoch)
            return;
        selectedBook.value = b;
        const local = progressStore.get(b).state.progress;
        this.setData({ book: b, podcastChapterId: local ? local.chapterId : '', ...catalog(b, this.seasonChoice, local && local.chapterId), totals: b.chapters.reduce((a, c) => [a[0] + c.sentenceCount, a[1] + c.playableCount], [0, 0]) });
        await progressStore.get(b).pull();
        if (!this.alive || op !== this.epoch)
            return;
        const saved = progressStore.get(b).state.progress;
        this.setData(catalog(b, this.seasonChoice, saved && saved.chapterId));
        this.refresh();
        if (this.continueRequested) {
            this.continueRequested = false;
            this.continueReading();
        }
    }
    catch (e) {
        if (this.alive && op === this.epoch)
            this.setData({ error: message(e), book: null });
    }
    finally {
        if (this.alive && op === this.epoch)
            this.setData({ busy: false });
    } },
    changeSeason(e) { const id = seasonIdAt(this.data.seasons, e.detail.value); if (!id || !this.data.book) return; this.seasonChoice = id; this.setData(catalog(this.data.book, id)); },
    open(id, sentence) { const b = this.data.book; if (!b || !b.chapters.some(c => c.id === id))
        return; navigate('/pages/reader/reader?bookId=' + encodeURIComponent(b.bookId) + '&buildId=' + encodeURIComponent(b.buildId) + '&chapterId=' + encodeURIComponent(id) + (sentence ? '&sentenceId=' + encodeURIComponent(sentence) : '')); },
    openChapter(e) { const id = e.currentTarget.dataset.id, loginUrl = lockedChapterLogin(this.data.book, id);
        if (loginUrl) {
            navigate(loginUrl);
            return;
        }
        this.open(id);
    },
    openPart(e) { this.open(e.detail.chapterId); },
    continueReading() { const b = this.data.book; if (!b)
        return; const r = progressStore.get(b); if (r.state.conflict && !r.state.deferred)
        return; const p = r.state.progress; const c = b.chapters.find(c => p && c.id === p.chapterId) || b.chapters.find(c => c.sentenceCount > 0); if (c)
        this.open(c.id, p && p.chapterId === c.id ? p.sentenceId : null); }
});
