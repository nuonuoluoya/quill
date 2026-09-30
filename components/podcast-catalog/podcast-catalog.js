const { PAGE_SIZE, episodeFor, podcastEpisodes, findEpisodes } = require('../../utils/podcast');
Component({
  properties: { book: Object, activeChapterId: String, compact: Boolean },
  data: { query: '', rows: [], page: 0, pageCount: 1, resultCount: 0, expandedId: '', scrollTarget: '' },
  observers: { 'book, activeChapterId': function () { this.sync(); } },
  lifetimes: { attached() { this.sync(); } },
  methods: {
    sync() {
      const book = this.properties.book;
      const key = book ? JSON.stringify([book.bookId, book.buildId]) : '';
      if (this.bookKey !== key) {
        this.bookKey = key;
        this.browsed = false;
        this.setData({ query: '', page: 0, expandedId: '' });
      }
      this.episodes = book ? podcastEpisodes(book) : [];
      if (!this.browsed && book) {
        const episode = episodeFor(book, this.properties.activeChapterId);
        const index = episode ? this.episodes.findIndex(e => e.id === episode.id) : -1;
        this.setData({ page: index < 0 ? 0 : Math.floor(index / PAGE_SIZE), expandedId: episode ? episode.id : '' });
      }
      this.render();
    },
    render() {
      const matches = findEpisodes(this.episodes || [], this.data.query);
      const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
      const page = Math.max(0, Math.min(this.data.page, pageCount - 1));
      this.setData({ page, pageCount, resultCount: matches.length, scrollTarget: '',
        rows: matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(e => ({ ...e,
          parts: e.parts.map(p => ({ ...p, current: !!p.chapterId && p.chapterId === this.properties.activeChapterId })) })) });
      this.locate(this.data.rows.some(row => row.id === this.data.expandedId) ? this.data.expandedId : (this.data.rows[0] || {}).id);
    },
    locate(id) { if (id) wx.nextTick(() => this.setData({ scrollTarget: 'episode-' + id })); },
    search(e) { this.browsed = true; this.setData({ query: e.detail.value, page: 0, expandedId: '' }); this.render(); },
    clearSearch() { this.search({ detail: { value: '' } }); },
    turn(e) {
      const page = this.data.page + Number(e.currentTarget.dataset.delta);
      if (!Number.isInteger(page) || page < 0 || page >= this.data.pageCount) return;
      this.browsed = true; this.setData({ page, expandedId: '' }); this.render();
    },
    toggle(e) {
      const id = e.currentTarget.dataset.id;
      if (!this.data.rows.some(row => row.id === id)) return;
      this.browsed = true; this.setData({ expandedId: this.data.expandedId === id ? '' : id, scrollTarget: '' }); this.locate(id);
    },
    select(e) {
      const id = e.currentTarget.dataset.id;
      const row = this.data.rows.find(row => row.id === this.data.expandedId);
      if (!id || !row || !row.parts.some(part => part.available && part.chapterId === id)) return;
      this.triggerEvent('select', { chapterId: id });
    }
  }
});
