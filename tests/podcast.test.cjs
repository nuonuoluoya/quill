const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { podcast, singleLessonPodcast, chapter } = require('./fixtures/podcast.cjs');
const { validPodcast, podcastEpisodes, findEpisodes } = require('../utils/podcast');
const { catalog, unitTitle } = require('../utils/catalog');
const { TYPES, present, recentPosition } = require('../utils/library-presentation');
const cache = new Map(), navigation = [], pages = [];
global.wx = { getStorageSync: k => cache.get(k), setStorageSync: (k, v) => cache.set(k, structuredClone(v)), removeStorageSync: k => cache.delete(k), getStorageInfoSync: () => ({ keys: [...cache.keys()] }), nextTick: f => f(), navigateTo: o => navigation.push(o.url) };
const auth = require('../models/auth');
const { content, checkBook, checkChapter } = require('../models/content');
const { player, playerState } = require('../models/player');
const { progressStore } = require('../models/progress');
const originals = { ...content }, originalApi = auth.api;
let definition;
global.Page = p => { definition = p; };
function page(name) {
  const file = require.resolve(`../pages/${name}/${name}`); delete require.cache[file]; require(file);
  const p = { ...definition, data: structuredClone(definition.data), setData(d) { Object.assign(this.data, d); } };
  pages.push(p); return p;
}
function component(book, activeChapterId = '') {
  let definition; global.Component = d => { definition = d; };
  const file = require.resolve('../components/podcast-catalog/podcast-catalog'); delete require.cache[file]; require(file);
  const events = [];
  const c = { ...definition.methods, data: structuredClone(definition.data), properties: { book, activeChapterId },
    setData(d) { Object.assign(this.data, d); }, triggerEvent(name, data) { events.push({ name, data }); }, events };
  definition.lifetimes.attached.call(c); return c;
}
const tick = () => new Promise(r => setImmediate(r));
const click = id => ({ currentTarget: { dataset: { id } } });
const chooseType = value => ({ currentTarget: { dataset: { value } } });
function setup(book) { content.book = async () => book; content.chapter = async (b, id) => chapter(b, id); content.snapshot = async () => book; auth.api = async () => book; }
afterEach(async () => {
  for (const p of pages.splice(0)) p.onUnload();
  player.dispose(); await auth.logout(); cache.clear(); navigation.length = 0;
  Object.assign(content, originals); auth.api = originalApi;
});

test('podcast is distinct from blog and counts episodes rather than learning parts', () => {
  const book = podcast();
  assert.equal(book.chapters.length, 722); assert.equal(checkBook(book), book);
  assert.deepEqual(TYPES.map(t => [t.value, t.label]), [
    ['all', '全部'], ['book', '书籍'], ['podcast', '播客'], ['movie', '电影'], ['tv', '电视剧']
  ]);
  assert.equal(present(book).metadata, '英文 · 播客 · 365 期');
  assert.doesNotMatch(present({ ...book, episodeCount: undefined }).metadata, /722/);
  assert.equal(catalog(book).catalogSummary, '365 期 · 722 个学习部分');
  assert.equal(catalog(book).chapters.length, 0, 'flat list must not mount 722 parts');
  assert.equal(unitTitle(book, 'ep337-dg'), '第 337 期 · 对话');
  assert.equal(recentPosition(book, { chapterId: 'ep001-pb' }, 'topic · 第 002 句'), '播客 · 第 1 期 · 教学 · 第 002 句');
});

test('contract rejects duplicate episodes/parts, orphan references and mismatched chapter bodies', () => {
  const book = podcast();
  for (const mutate of [
    b => { b.episodes[1].id = b.episodes[0].id; },
    b => { b.episodes[1].number = b.episodes[0].number; },
    b => { b.episodes[0].number = 0; },
    b => { b.chapters[0].episodeId = 'missing'; },
    b => { b.chapters[1].part = 'dialogue'; },
    b => { b.chapters[0].part = 'other'; },
    b => { b.chapters[0].seasonId = 'season'; },
    b => { b.episodeCount = 722; }
  ]) { const bad = structuredClone(book); mutate(bad); assert.equal(validPodcast(bad), false); assert.throws(() => checkBook(bad), /内容格式不一致/); }
  const body = chapter(book, 'ep001-dg');
  assert.equal(checkChapter(body, book), body);
  assert.throws(() => checkChapter({ ...body, part: 'lesson' }, book), /内容格式不一致/);
  assert.throws(() => checkChapter({ ...body, episodeId: 'ep002' }, book), /内容格式不一致/);
});

test('365 episodes paginate at 20; eight missing parts remain visible and cannot emit navigation', () => {
  const c = component(podcast(), 'ep337-dg');
  assert.equal(c.data.page, 16); assert.equal(c.data.rows.length, 20); assert.equal(c.data.expandedId, 'ep337');
  const all = podcastEpisodes(podcast());
  assert.equal(all.flatMap(e => e.parts).filter(p => !p.available).length, 8);
  c.select(click('')); c.select(click('ep337-pb')); assert.equal(c.events.length, 0);
  c.select(click('ep337-dg')); assert.equal(c.events[0].data.chapterId, 'ep337-dg');
  for (const query of ['337', 'ep337', '第337期', 'new city']) {
    c.search({ detail: { value: query } }); assert.equal(c.data.rows.length, 1); assert.equal(c.data.rows[0].number, 337);
  }
  c.search({ detail: { value: 'no-such-topic' } }); assert.equal(c.data.rows.length, 0);
  c.clearSearch(); assert.equal(c.data.page, 0); assert.equal(c.data.rows.length, 20);
  c.turn({ currentTarget: { dataset: { delta: 1 } } }); assert.equal(c.data.rows[0].number, 21);
  c.properties.activeChapterId = 'ep100-dg'; c.sync(); assert.equal(c.data.page, 1, 'late progress must not overwrite browsing');
  c.properties.book = null; c.sync(); assert.equal(c.data.rows.length, 0, 'identity reset clears prior program');
  assert.deepEqual(findEpisodes(all, 'ep032').map(e => e.number), [32]);
});

test('single-lesson declaration shows only real lessons without inferring parts from chapters', () => {
  const book = singleLessonPodcast(); assert.equal(checkBook(book), book);
  const rows = podcastEpisodes(book); assert.equal(rows.length, 708);
  assert.ok(rows.every(e => e.parts.length === 1 && e.parts[0].key === 'lesson' && e.parts[0].available));
  const legacy = { ...book }; delete legacy.podcastParts;
  assert.equal(checkBook(legacy), legacy);
  assert.ok(podcastEpisodes(legacy).every(e => e.parts.length === 2 && e.parts[0].available === false));
  const explicitDual = { ...legacy, podcastParts: ['dialogue', 'lesson'] };
  assert.deepEqual(podcastEpisodes(explicitDual), podcastEpisodes(legacy));
  const dialogueOnly = { ...book, podcastParts: ['dialogue'], chapters: book.chapters.map(c => ({ ...c, part: 'dialogue' })) };
  assert.equal(checkBook(dialogueOnly), dialogueOnly);
  assert.ok(podcastEpisodes(dialogueOnly).every(e => e.parts.length === 1 && e.parts[0].key === 'dialogue'));
});

test('podcast part declarations reject invalid shape, order, duplicates and undeclared chapter parts', () => {
  for (const podcastParts of [null, [], 'lesson', {}, ['other'], ['lesson', 'lesson'], ['lesson', 'dialogue'], ['dialogue', 'lesson', 'other']]) {
    const bad = { ...singleLessonPodcast(), podcastParts };
    assert.equal(validPodcast(bad), false); assert.throws(() => checkBook(bad), /内容格式不一致/);
  }
  const bad = singleLessonPodcast(); bad.chapters[0].part = 'dialogue';
  assert.equal(validPodcast(bad), false); assert.throws(() => checkBook(bad), /内容格式不一致/);
  for (const contentType of ['book', 'tv', 'movie', 'blog', undefined])
    assert.throws(() => checkBook({ ...singleLessonPodcast(), contentType }), /内容格式不一致/);
});

test('708 sparse episodes stay at 20 per render; searching and saved position preserve original episode numbers', () => {
  const c = component(singleLessonPodcast(), 'ep0716-lesson');
  assert.equal(c.data.page, 35); assert.equal(c.data.pageCount, 36); assert.equal(c.data.rows.length, 8);
  assert.equal(c.data.expandedId, 'ep0716'); assert.equal(c.data.rows.at(-1).number, 716);
  c.select(click('ep0716-dialogue')); assert.equal(c.events.length, 0);
  c.select(click('ep0716-lesson')); assert.equal(c.events[0].data.chapterId, 'ep0716-lesson');
  for (const query of ['0716', 'ep0716', '第716期', 'Practice Lesson 716']) {
    c.search({ detail: { value: query } }); assert.equal(c.data.rows.length, 1); assert.equal(c.data.rows[0].number, 716);
  }
  for (const n of [423, 445, 446, 447, 488, 546, 576, 646]) {
    c.search({ detail: { value: String(n) } }); assert.equal(c.data.rows.length, 0);
  }
  c.clearSearch(); const numbers = [];
  for (let page = 0; page < 36; page++) {
    assert.ok(c.data.rows.length <= 20); numbers.push(...c.data.rows.map(e => e.number));
    c.turn({ currentTarget: { dataset: { delta: 1 } } });
  }
  assert.equal(numbers.length, 708); assert.equal(new Set(numbers).size, 708); assert.equal(numbers.at(-1), 716);
  assert.ok(c.data.rows.every(e => e.parts.length === 1));
});

test('single-lesson directory and reader picker restore the precise lesson without a phantom dialogue', async () => {
  const book = singleLessonPodcast(); setup(book);
  progressStore.get(book).state.progress = { bookId: book.bookId, sourceBuildId: book.buildId, textRevision: book.textRevision,
    chapterId: 'ep0716-lesson', sentenceId: 'ep0716-lesson-s1', preferredSpeed: 1 };
  const directory = page('book'); directory.onLoad({ bookId: book.bookId }); await tick();
  const index = component(directory.data.book, directory.data.podcastChapterId);
  assert.equal(index.data.page, 35); assert.equal(index.data.rows.at(-1).parts.length, 1);
  directory.continueReading(); assert.match(navigation.at(-1), /chapterId=ep0716-lesson&sentenceId=ep0716-lesson-s1$/);
  const reader = page('reader'); reader.onLoad({ bookId: book.bookId, buildId: book.buildId, chapterId: 'ep0716-lesson', sentenceId: 'ep0716-lesson-s1' }); await tick();
  assert.equal(reader.data.book.podcastParts[0], 'lesson'); assert.equal(reader.data.chapterLabel, '第 716 期 · 教学');
  reader.showChapters(); const picker = component(reader.data.book, reader.data.chapter.chapterId);
  assert.equal(picker.data.expandedId, 'ep0716'); assert.equal(picker.data.rows.at(-1).parts.length, 1);
  assert.equal(player.audio, null); assert.equal(playerState.status, 'selected');
});

test('directory restores saved part and blocks missing IDs without creating audio', async () => {
  const book = podcast(); setup(book);
  progressStore.get(book).state.progress = { bookId: book.bookId, textRevision: book.textRevision, chapterId: 'ep337-dg', sentenceId: 'ep337-dg-s2', preferredSpeed: 1 };
  const p = page('book'); p.onLoad({ bookId: book.bookId }); await tick();
  assert.equal(p.data.podcastChapterId, 'ep337-dg'); assert.match(p.data.position, /第 337 期 · 对话/);
  p.openPart({ detail: { chapterId: 'ep337-pb' } }); assert.equal(navigation.length, 0);
  p.continueReading(); assert.match(navigation.at(-1), /chapterId=ep337-dg&sentenceId=ep337-dg-s2$/);
  assert.equal(player.audio, null);
});

test('reader browsing preserves playback; selection stops old audio, keeps unavailable sentences, and reopens current part', async () => {
  const book = podcast(); setup(book);
  const p = page('reader'); p.onLoad({ bookId: book.bookId, chapterId: 'ep001-dg' }); await tick();
  assert.equal(p.data.chapterLabel, '第 1 期 · 对话'); assert.equal(p.data.rows[1].available, false);
  assert.equal(p.data.chapter.chapterAudio.status, 'unavailable');
  let stopped = 0; player.audio = { stop() { stopped++; }, destroy() {} }; playerState.status = 'playing';
  p.showChapters(); const selector = component(book, p.data.chapter.chapterId);
  selector.search({ detail: { value: '337' } }); selector.toggle(click('ep337'));
  assert.equal(stopped, 0); assert.equal(p.data.chapter.chapterId, 'ep001-dg');
  await p.choosePart({ detail: { chapterId: 'ep001-dg' } }); assert.equal(stopped, 0); assert.equal(p.data.sheet, false);
  await p.choosePart({ detail: { chapterId: 'ep001-pb' } });
  assert.equal(stopped, 1); assert.equal(playerState.status, 'selected'); assert.equal(p.data.chapterLabel, '第 1 期 · 教学');
  assert.equal(progressStore.get(book).state.progress.chapterId, 'ep001-pb');
  p.showChapters(); assert.equal(component(book, p.data.chapter.chapterId).data.expandedId, 'ep001');
  p.click({ currentTarget: { dataset: { index: 2 } } }); assert.equal(playerState.status, 'unavailable');
});

test('late cross-part responses cannot overwrite the last selection or progress', async () => {
  const book = podcast(); setup(book);
  const p = page('reader'); p.onLoad({ bookId: book.bookId, chapterId: 'ep001-dg' }); await tick();
  const pending = []; content.chapter = (b, id) => new Promise(resolve => pending.push({ id, resolve }));
  const first = p.choosePart({ detail: { chapterId: 'ep001-pb' } }); await tick();
  const last = p.choosePart({ detail: { chapterId: 'ep337-dg' } }); await tick();
  pending[1].resolve(chapter(book, pending[1].id)); await last;
  const revision = progressStore.get(book).state.revision;
  pending[0].resolve(chapter(book, pending[0].id)); await first;
  assert.equal(p.data.chapter.chapterId, 'ep337-dg'); assert.equal(progressStore.get(book).state.revision, revision);
});

test('podcast API sends contentType with encoded cursor', async () => {
  let url;
  wx.request = o => { url = o.url; o.success({ statusCode: 200, data: { data: { items: [], nextCursor: null } } }); };
  await content.list('member', 'podcast+cursor', 'podcast');
  assert.match(url, /contentType=podcast/); assert.match(url, /cursor=podcast%2Bcursor/);
});

test('podcast server pagination does not reuse mixed cursors and ignores responses after filter/account changes', async () => {
  const book = podcast(), calls = [], pending = [];
  auth.auth.session = { user: { id: 'member-fixture' } };
  content.list = (audience, cursor, type) => { calls.push({ audience, cursor, type }); return new Promise(resolve => pending.push(resolve)); };
  const p = page('library'); p.onLoad();
  pending.shift()({ items: [], nextCursor: 'mixed-cursor' }); await tick();
  const first = p.changeType(chooseType('podcast'));
  assert.equal(calls.at(-1).type, 'podcast'); assert.equal(calls.at(-1).cursor, undefined);
  pending.shift()({ items: [book], nextCursor: 'podcast-cursor' }); await first;
  const more = p.loadMore(); assert.equal(calls.at(-1).cursor, 'podcast-cursor'); assert.equal(calls.at(-1).type, 'podcast');
  const stale = pending.shift(); const back = p.changeType(chooseType('book'));
  assert.equal(calls.at(-1).cursor, undefined); assert.equal(calls.at(-1).type, undefined);
  pending.shift()({ items: [], nextCursor: null }); await back;
  stale({ items: [{ ...book, bookId: 'late' }], nextCursor: 'stale' }); await more;
  assert.equal(p.data.books.length, 0); assert.equal(p.data.nextCursor, null);
  const second = p.changeType(chooseType('podcast')); const accountStale = pending.shift();
  await auth.logout(); accountStale({ items: [book], nextCursor: null }); await second;
  assert.equal(p.data.books.length, 0); assert.equal(p.data.loggedIn, false);
});
