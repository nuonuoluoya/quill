const { content } = require('../../models/content');
const { auth, onIdentityChange } = require('../../models/auth');
const { progressStore } = require('../../models/progress');
const { message, navigate } = require('../../utils/http');
const { TYPES, present, visible, recentPosition } = require('../../utils/library-presentation');

Page({
  data: { books: [], visibleBooks: [], types: TYPES, selectedType: 'all', audience: 'sample', nextCursor: null, busy: false, error: '', recent: null, loggedIn: false },
  onLoad() {
    this.alive = true;
    this.epoch = 0;
    this.recentEpoch = 0;
    this.setData({ audience: auth.session ? 'member' : 'sample' });
    this.off = onIdentityChange(() => {
      this.epoch++;
      this.recentEpoch++;
      this.setData({ books: [], visibleBooks: [], recent: null, loggedIn: !!auth.session, audience: auth.session ? 'member' : 'sample', nextCursor: null, busy: false });
      this.load(true);
    });
    this.load(true);
  },
  onShow() { this.setData({ loggedIn: !!auth.session }); this.loadRecent(); },
  onUnload() { this.alive = false; this.epoch++; this.recentEpoch++; if (this.off) this.off(); },
  onPullDownRefresh() { this.load(true).finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { return this.loadMore(); },
  async load(reset = true) {
    if (this.data.busy) return;
    const op = ++this.epoch;
    const { audience, selectedType } = this.data;
    let cursor = reset ? undefined : this.data.nextCursor;
    this.setData({ busy: true, error: '' });
    try {
      const byId = new Map((reset ? [] : this.data.books).map(b => [b.bookId, b]));
      const seen = new Set();
      // The existing API paginates all types. Scan bounded batches so a type
      // absent from the first page is not incorrectly reported as empty.
      for (let page = 0; page < 5; page++) {
        const r = await content.list(audience, cursor);
        if (!this.alive || op !== this.epoch) return;
        r.items.forEach(b => byId.set(b.bookId, present(b)));
        const books = [...byId.values()];
        const addedMatches = visible(r.items.map(present), selectedType).length;
        if (r.nextCursor && (r.nextCursor === cursor || seen.has(r.nextCursor))) throw Error('分页暂时不可用，请下拉刷新');
        this.setData({ books, visibleBooks: visible(books, selectedType), nextCursor: r.nextCursor });
        if (!r.nextCursor || addedMatches || selectedType === 'all') break;
        seen.add(r.nextCursor);
        cursor = r.nextCursor;
      }
      await this.loadRecent();
    } catch (e) {
      if (this.alive && op === this.epoch) this.setData({ error: message(e) });
    } finally {
      if (this.alive && op === this.epoch) this.setData({ busy: false });
    }
  },
  async loadRecent() {
    const op = ++this.recentEpoch;
    const id = progressStore.recent();
    if (!id) { this.setData({ recent: null }); return; }
    try {
      const b = await content.book(id);
      if (!this.alive || op !== this.recentEpoch) return;
      const p = progressStore.get(b).state.progress;
      this.setData({ recent: p ? { ...b, position: recentPosition(b, p, progressStore.position(b, p)) } : null });
    } catch (_) {
      if (this.alive && op === this.recentEpoch) this.setData({ recent: null });
    }
  },
  changeAudience(e) {
    const audience = e.currentTarget.dataset.value;
    if (!['member', 'sample'].includes(audience) || audience === this.data.audience) return;
    if (audience === 'member' && !auth.session) { navigate('/pages/settings/settings'); return; }
    this.epoch++;
    this.setData({ audience, books: [], visibleBooks: [], nextCursor: null, busy: false, error: '' });
    return this.load(true);
  },
  changeType(e) {
    const selectedType = e.currentTarget.dataset.value;
    if (!TYPES.some(t => t.value === selectedType) || selectedType === this.data.selectedType) return;
    const pendingInitial = !this.data.books.length && (this.data.busy || !!this.data.error);
    this.epoch++;
    const visibleBooks = visible(this.data.books, selectedType);
    this.setData({ selectedType, visibleBooks, busy: false, error: '' });
    if (pendingInitial) return this.load(true);
    if (!visibleBooks.length && this.data.nextCursor) return this.load(false);
  },
  coverError(e) {
    const books = this.data.books.map(b => b.bookId === e.currentTarget.dataset.id ? { ...b, coverUrl: '' } : b);
    this.setData({ books, visibleBooks: visible(books, this.data.selectedType) });
  },
  openBook(e) { navigate('/pages/book/book?bookId=' + encodeURIComponent(e.currentTarget.dataset.id)); },
  continueReading() {
    if (this.data.recent) navigate('/pages/book/book?bookId=' + encodeURIComponent(this.data.recent.bookId) + '&continue=1');
  },
  loadMore() { if (this.data.nextCursor && !this.data.busy) return this.load(false); },
  retry() { return this.load(true); }
});
