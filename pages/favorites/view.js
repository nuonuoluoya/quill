const { FavoritePractice, referenceKey } = require('../../core/favorite-practice');
const { player, playerState } = require('../../models/player');
const { shadowing, shadowState } = require('../../models/shadowing');
const { cleanupState } = require('../../models/audio-cleanup');
const { auth, identity, onIdentityChange } = require('../../models/auth');
const { subscribe } = require('../../utils/events');
const { message, navigate, toLibrary } = require('../../utils/http');

const scopeKey = () => JSON.stringify([identity(), auth.epoch]);
const restricted = code => ['FAVORITE_UNAVAILABLE','FAVORITE_NOT_FOUND','BOOK_FORBIDDEN','BUILD_REVOKED','BUILD_RETIRED','BUILD_NOT_FOUND','SENTENCE_NOT_FOUND','SESSION_EXPIRED'].includes(code);
function createFavoritesPage(service) {
  return {
    data: { scrollEpoch: 0, rows: [], query: '', total: 0, playableCount: 0, hasMore: false, busy: false, error: '', openedId: '', pendingId: '', frozen: false, currentChapter: null, queueIndex: -1, queueTotal: 0, selecting: false },
    onLoad() {
      this.alive = true; this.active = false; this.epoch = 0; this.items = [];
      this.practice = new FavoritePractice({ player, state: playerState, resolve: item => service.resolve(item), closeShadow: () => shadowing.reset(),
        changed: () => this.refresh(), failed: (error, item) => this.failed(error,item) });
      this.off = subscribe(() => this.refresh());
      this.identityOff = onIdentityChange(() => { this.epoch++; this.practice.queue = []; if (this.active) this.practice.clear(); this.items = []; this.setData({ rows: [], currentChapter: null, openedId: '', pendingId: '' }); if (this.active) this.reload(); });
    },
    onShow() { this.active = true; this.life = (this.life || 0) + 1; this.practice.attach(); shadowing.resume(); player.setForeground(true); this.reload(); clearInterval(this.timer); this.timer = setInterval(()=>this.checkCurrent(),60000); },
    onHide() { this.active = false; this.life++; clearInterval(this.timer); this.epoch++; this.practice.detach(); shadowing.reset(); this.items = []; this.setData({ rows: [], busy: false, openedId: '', pendingId: '', currentChapter: null }); },
    onUnload() { this.active = false; this.life++; clearInterval(this.timer); this.alive = false; this.epoch++; this.practice.detach(); this.off(); this.identityOff(); },
    refresh() {
      if (!this.alive || !this.active) return;
      const p = this.practice, selected = p.current && referenceKey(p.current);
      if (p.current && restricted(playerState.errorCode)) { this.failed(Object.assign(Error(playerState.error), {code:playerState.errorCode}),p.current); return; }
      this.setData({ rows: this.items.map(item => ({ ...item, saved: true, selected: !!selected && referenceKey(item) === selected, playing: referenceKey(item) === selected && playerState.status === 'playing' })),
        frozen: cleanupState.busy || shadowState.open, selecting: !!p.loading, currentChapter: p.target?.chapter || (p.loading ? this.data.currentChapter : null), queueIndex: p.index(), queueTotal: p.queue.length });
    },
    async reload() { this.cursor = null; return this.read(false); },
    async read(append, retried = false) {
      if (!this.active || (append && this.data.busy)) return;
      const op = ++this.epoch, owner = scopeKey();
      const current = () => this.alive && this.active && op === this.epoch && owner === scopeKey();
      this.setData({ busy: true, error: '', openedId: '' });
      try {
        const result = await service.list({ query: this.data.query, cursor: append ? this.cursor : null });
        if (!current()) return;
        for (const item of result.items) if (!item.locatable) { const queued = this.practice.queue.find(i=>i.id===item.id); if (queued) this.practice.remove(queued); }
        this.items = append ? [...new Map([...this.items, ...result.items].map(i=>[i.id,i])).values()] : result.items;
        this.cursor = result.nextCursor;
        this.setData({ total: result.total, playableCount: result.playableCount, hasMore: !!result.nextCursor });
        this.refresh();
      } catch (error) { if (current()) { if (error.code === 'FAVORITES_CHANGED' && !retried) { this.items = []; this.cursor = null; this.refresh(); return this.read(false,true); } this.setData({ error: message(error) }); } }
      finally { if (current()) this.setData({ busy: false }); }
    },
    more() { if (this.data.hasMore) return this.read(true); },
    search(e) { this.setData({ query: e.detail.value }); this.reload(); },
    clearSearch() { this.search({ detail: { value: '' } }); },
    reveal(e) { if (!this.data.frozen && !(e.detail.open && this.rowsScrolling)) this.setData({ openedId: e.detail.open ? e.detail.id : '' }); },
    beginScroll() { this.rowsScrolling = false; },
    scrollRows() { if (!this.rowsScrolling) { this.rowsScrolling = true; this.setData({ scrollEpoch: this.data.scrollEpoch + 1 }); } this.closeSwipe(); },
    closeSwipe() { if (this.data.openedId) this.setData({ openedId: '' }); },
    play(e) { if (this.data.frozen) return; const item = this.items.find(row => row.id === e.detail.id); if (item?.available) { this.closeSwipe(); return this.practice.choose(item, this.items); } },
    async favorite(e) {
      if (this.data.frozen || this.data.pendingId) return;
      const item = this.items.find(row => row.id === e.detail.id); if (!item) return;
      const owner = scopeKey(), life = this.life; const current = () => this.alive && this.active && this.life === life && scopeKey() === owner; this.setData({ pendingId: item.id, error: '' });
      try {
        const receipt = await service.remove(item);
        if (!current()) return;
        if (!receipt.saved) { this.practice.remove(item); this.items = this.items.filter(row => row.id !== item.id); } this.setData({ openedId: '' }); this.refresh(); await this.reload();
      } catch (error) { if (current()) { if (error.code === 'FAVORITES_CHANGED') await this.reload(); if (current()) this.setData({ error: message(error) }); } }
      finally { if (current()) this.setData({ pendingId: '' }); }
    },
    action(e) {
      if (this.data.frozen || this.practice.loading || !this.practice.target) return;
      const a = e.detail.action;
      if (a === 'previous' || a === 'next') {
        const delta = a === 'previous' ? -1 : 1, index = this.practice.index();
        if (index < 0 || !this.practice.queue[index + delta]) return;
        this.closeSwipe(); return this.practice.navigate(delta);
      }
      if (a === 'toggle') { if (playerState.status === 'playing' || playerState.status === 'loading') player.pause(); else return this.practice.resume(); }
      if (a === 'loop') player.setLoop(!playerState.loop);
      if (a === 'continuous') player.setContinuous(!playerState.continuous);
    },
    openShadowing() {
      if (this.data.frozen || this.practice.loading || !this.practice.target) return;
      shadowing.open({ owner: identity(), ...this.practice.target, speed: playerState.speed });
    },
    locate() { if (this.practice.current) return this.openSource(this.practice.current); },
    source(e) { const item = this.items.find(row => row.id === e.detail.id); if (item?.locatable) return this.openSource(item); },
    async openSource(item) {
      if (this.data.frozen) return;
      const epoch = this.epoch, owner = scopeKey(), request = this.sourceRequest = (this.sourceRequest || 0) + 1;
      try {
        const target = await service.resolve(item);
        if (!this.alive || !this.active || epoch !== this.epoch || scopeKey() !== owner || request !== this.sourceRequest) return;
        this.practice.clear();
        navigate('/pages/reader/reader?bookId=' + encodeURIComponent(target.book.bookId) + '&buildId=' + encodeURIComponent(target.book.buildId) + '&chapterId=' + encodeURIComponent(target.chapter.chapterId) + '&sentenceId=' + encodeURIComponent(target.sentence.id));
      } catch (error) { if (this.alive && this.active && epoch === this.epoch && request === this.sourceRequest && scopeKey() === owner) this.failed(error,item); }
    },
    failed(error, item) {
      if (!this.alive || !this.active) return;
      if (item && restricted(error.code)) {
        this.practice.remove(item);
        if (error.code === 'FAVORITE_NOT_FOUND') this.items = this.items.filter(i=>i.id!==item.id);
        else this.items = this.items.map(i=>i.id===item.id ? (error.favoriteItem || {id:item.id,favoriteId:item.id,saved:true,available:false,locatable:false,text:'',source:'',unavailableLabel:'内容暂不可用'}) : i);
        this.refresh();
      }
      this.setData({error:message(error)});
    },
    async checkCurrent() {
      const item = this.practice.current, life = this.life, operation = this.practice.operation;
      if (!this.active || !item || this.checking) return;
      this.checking = true;
      try { await service.resolve(item); }
      catch (error) { if (this.active && this.life === life && this.practice.operation === operation) this.failed(error,item); }
      finally { this.checking = false; }
    },
    library() { toLibrary(); }
  };
}
module.exports = { createFavoritesPage };
