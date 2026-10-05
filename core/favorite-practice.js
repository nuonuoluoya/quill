const { playable } = require('../utils/contracts');
const referenceKey = r => JSON.stringify([r.bookId, r.textRevision, r.chapterId, r.sentenceId]);

// Playback only: persistence and authorized resolution are supplied by the caller.
// A queue is a snapshot of the last explicit selection's visible, playable results.
class FavoritePractice {
  constructor({ player, state, resolve, changed = () => {}, failed = () => {}, closeShadow = () => {} }) {
    Object.assign(this, { player, state, resolve, changed, failed, closeShadow });
    this.queue = []; this.current = null; this.target = null; this.operation = 0; this.active = false;
  }
  attach() {
    this.active = true;
    this.current = null; this.target = null; this.queue = []; this.loading = false;
    this.player.onSelection = () => {};
    this.ended = () => {
      if (!this.active || !this.current) return false;
      if (this.state.loop) return false;
      if (this.state.continuous) void this.navigate(1, true);
      return true; // Never advance to an uncollected sentence in the source chapter.
    };
    this.player.onEnded = this.ended;
    this.player.dispose();
  }
  async choose(item, visible) {
    if (!this.active || !item.available) return;
    this.queue = visible.filter(row => row.available).map(row => ({ ...row }));
    if (this.current && this.target && referenceKey(item) === referenceKey(this.current)) { if (this.state.status === 'playing' || this.state.status === 'loading') { this.player.pause(); this.changed(); return; } return this.resume(); }
    return this.select(item, true);
  }
  async resume() {
    if (!this.active || !this.current || !this.target || this.loading) return;
    const item = this.current, target = this.target, op = ++this.operation;
    this.loading = true; this.changed();
    try {
      const latest = await this.resolve(item);
      if (!this.active || op !== this.operation) return;
      if (!playable(latest.sentence)) throw Error('收藏句子已不可播放，请刷新列表');
      this.loading = false;
      if (latest.book.buildId !== target.book.buildId) return this.select(item,true);
      this.player.toggle(); this.changed();
    } catch (error) {
      if (this.active && op === this.operation) { this.clear(); this.failed(error,item); }
    }
  }
  async select(item, play) {
    const op = ++this.operation;
    const { speed, loop, continuous } = this.state;
    this.closeShadow(); this.player.dispose(); this.current = item; this.target = null; this.loading = true; this.changed();
    try {
      const target = await this.resolve(item);
      if (!this.active || op !== this.operation) return;
      const { book, chapter, sentence } = target;
      const resolvedKey = referenceKey({ bookId: book.bookId, textRevision: book.textRevision, chapterId: chapter.chapterId, sentenceId: sentence.id });
      const index = chapter.sentences.findIndex(s => s.id === sentence.id);
      if (referenceKey(item) !== resolvedKey || index < 0 || !playable(sentence)) throw Error('收藏句子已不可播放，请刷新列表');
      this.target = target; this.loading = false;
      this.player.onSelection = () => {};
      this.player.load(book, chapter, index);
      this.player.setSpeed(speed); this.player.setLoop(loop); this.player.setContinuous(continuous);
      this.changed();
      if (play) this.player.toggle();
    } catch (error) {
      if (this.active && op === this.operation) { this.current = null; this.target = null; this.loading = false; this.failed(error, item); this.changed(); }
    }
  }
  async navigate(delta, play = this.state.status === 'playing' || this.state.status === 'loading') {
    const index = this.index(), next = index + delta;
    if (index < 0 || next < 0 || next >= this.queue.length) return;
    return this.select(this.queue[next], play);
  }
  index() { return this.current ? this.queue.findIndex(row => referenceKey(row) === referenceKey(this.current)) : -1; }
  remove(item) {
    if (this.current && referenceKey(item) === referenceKey(this.current)) this.clear();
    this.queue = this.queue.filter(row => referenceKey(row) !== referenceKey(item)); this.changed();
  }
  clear() {
    this.operation++; this.closeShadow(); this.player.dispose(); this.current = null; this.target = null; this.loading = false; this.changed();
  }
  detach() {
    if (!this.active && this.player.onEnded !== this.ended) return;
    this.active = false; this.queue = []; this.clear();
    if (this.player.onEnded === this.ended) this.player.onEnded = null;
    this.player.onSelection = () => {};
  }
}
module.exports = { FavoritePractice, referenceKey };
