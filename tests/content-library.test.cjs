const { test } = require('node:test');
const assert = require('node:assert/strict');
const { present, recentPosition } = require('../utils/library-presentation');
let definition;
global.Page = p => { definition = p; };
global.wx = { getStorageSync() {}, getStorageInfoSync: () => ({ keys: [] }), nextTick: f => f() };
const { content } = require('../models/content');
const { progressStore } = require('../models/progress');
progressStore.recent = () => null;
const tick = () => new Promise(r => setImmediate(r));
const item = (id, type = 'book') => ({ bookId: id, title: id, language: 'en', contentType: type, chapterCount: 8, chapterAudioAvailableCount: 8, contentChapterCount: 8, contentScope: 'complete' });
function page() {
  delete require.cache[require.resolve('../pages/library/library')];
  require('../pages/library/library');
  return { ...definition, data: structuredClone(definition.data), setData(d) { Object.assign(this.data, d); } };
}
const choose = value => ({ currentTarget: { dataset: { value } } });

test('类型、单位和音频状态来自元数据，兼容旧书籍且未知类型不冒充书籍', () => {
  for (const [type, label, unit] of [['book','书籍','章'],['blog','博客','篇'],['movie','电影','段'],['tv','电视剧','集']]) {
    const b = present(item('x', type));
    assert.equal(b.metadata, `英文 · ${label} · 8 ${unit}`);
    assert.equal(b.audioLabel, '全文音频可用');
  }
  assert.equal(present(item('old', undefined)).contentType, 'book');
  assert.equal(present(item('x', 'podcast')).contentType, 'unknown');
  assert.equal(present({ ...item('x'), chapterAudioAvailableCount: 2 }).audioLabel, '部分全文音频可用');
  assert.match(present({ ...item('x'), contentScope: 'sample' }).metadata, /样本/);
  assert.equal(present({ ...item('x'), coverUrl: 'http://unsafe.invalid/a.jpg' }).coverUrl, '');
});

test('筛选遍历后续分页，去重并保持真实空状态；切回全部保留已加载内容', async () => {
  const calls = [];
  content.list = async (a, c) => {
    calls.push(c);
    return !c ? { items: [item('book')], nextCursor: 'second' } : c === 'second' ? { items: [item('book'), item('blog', 'blog')], nextCursor: 'third' } : { items: [item('film', 'movie')], nextCursor: null };
  };
  const p = page(); p.onLoad(); await tick();
  await p.changeType(choose('movie'));
  assert.deepEqual(calls, [undefined, 'second', 'third']);
  assert.deepEqual(p.data.visibleBooks.map(b => b.bookId), ['film']);
  assert.equal(p.data.books.length, 3);
  await p.changeType(choose('tv'));
  assert.equal(p.data.visibleBooks.length, 0);
  assert.equal(p.data.nextCursor, null);
  await p.changeType(choose('all'));
  assert.equal(p.data.visibleBooks.length, 3);
  p.onUnload();
});

test('快速切换类型时旧请求不能覆盖新筛选结果', async () => {
  let late;
  content.list = async (a, c) => !c ? { items: [item('book')], nextCursor: 'next' } : new Promise(r => { late = r; });
  const p = page(); p.onLoad(); await tick();
  const pending = p.changeType(choose('movie'));
  await tick();
  await p.changeType(choose('book'));
  late({ items: [item('film', 'movie')], nextCursor: null });
  await pending;
  assert.equal(p.data.selectedType, 'book');
  assert.deepEqual(p.data.visibleBooks.map(b => b.bookId), ['book']);
  assert.equal(p.data.busy, false);
  p.onUnload();
});

test('筛选扫描有界，仍有分页时不能误报最终空状态', async () => {
  let n = 0;
  content.list = async () => ({ items: [item('b' + (++n))], nextCursor: 'cursor-' + n });
  const p = page(); p.onLoad(); await tick();
  await p.changeType(choose('tv'));
  assert.equal(n, 6);
  assert.equal(p.data.visibleBooks.length, 0);
  assert.ok(p.data.nextCursor);
  p.onUnload();
});

test('刷新失败保留内容，封面加载失败恢复同类型本地配图', async () => {
  content.list = async () => ({ items: [{ ...item('blog', 'blog'), coverUrl: 'https://example.com/cover.jpg' }], nextCursor: null });
  const p = page(); p.onLoad(); await tick();
  p.coverError({ currentTarget: { dataset: { id: 'blog' } } });
  assert.equal(p.data.visibleBooks[0].coverUrl, '');
  assert.equal(p.data.visibleBooks[0].coverArt, 'blog');
  content.list = async () => { throw Error('offline'); };
  await p.retry();
  assert.equal(p.data.visibleBooks.length, 1);
  assert.equal(p.data.error, 'offline');
  p.onUnload();
});

test('继续学习映射剧集位置，保留句子编号', () => {
  assert.equal(recentPosition({ contentType: 'tv', chapters: [{id:'e1'}, {id:'e2'}] }, {chapterId:'e2'}, 'Episode Two · 第 018 句'), '电视剧 · 第 2 集 · 第 018 句');
});
