const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { catalog, unitTitle } = require('../utils/catalog');
const { present, recentPosition } = require('../utils/library-presentation');
const cache = new Map(), navigation = [];
global.wx = { getStorageSync: k => cache.get(k), setStorageSync: (k, v) => cache.set(k, structuredClone(v)), removeStorageSync: k => cache.delete(k), getStorageInfoSync: () => ({ keys: [...cache.keys()] }), nextTick: f => f(), navigateTo: o => navigation.push(o.url) };
const auth = require('../models/auth');
const { content } = require('../models/content');
const { player, playerState } = require('../models/player');
const { progressStore } = require('../models/progress');
const tv = { bookId: 'tv-test', buildId: 'build', textRevision: 'text', contentType: 'tv', contentScope: 'complete', title: 'Test Series', seasons: [{ id: 's2', title: '第二季', order: 2 }, { id: 's1', title: '第一季', order: 1 }], chapters: [
  { id: 'a', seasonId: 's1', episodeNumber: 1, title: 'Original 01 A', sentenceCount: 2, playableCount: 2 },
  { id: 'b', seasonId: 's1', episodeNumber: 3, title: 'Original 01 B', sentenceCount: 2, playableCount: 2 },
  { id: 'c', seasonId: 's2', episodeNumber: 1, title: 'Another Start', sentenceCount: 2, playableCount: 2 }
] };
const chapter = id => ({ bookId: tv.bookId, buildId: tv.buildId, textRevision: tv.textRevision, chapterId: id, chapterAudio: { status: 'unavailable', audioId: null, duration: null, reasons: ['Missing'] }, sentences: [1, 2].map(index => ({ id: id + '-s' + index, index, text: 'Test sentence', audioId: id + '-a' + index, duration: 2, alignment: { status: 'verified', reasons: [] } })) });
let definition;
global.Page = p => { definition = p; };
const pages = [];
function page(name) {
  const file = require.resolve(`../pages/${name}/${name}`); delete require.cache[file]; require(file);
  const p = { ...definition, data: structuredClone(definition.data), setData(d) { Object.assign(this.data, d); } }; pages.push(p); return p;
}
const tick = () => new Promise(r => setImmediate(r));
function setup() { content.book = async () => tv; content.chapter = async (b, id) => chapter(id); auth.api = async () => tv; navigation.length = 0; }
afterEach(async () => { for (const p of pages.splice(0)) p.onUnload(); player.dispose(); await auth.logout(); cache.clear(); });

test('season metadata preserves sparse episode numbers, duplicate numbers across seasons and source titles', () => {
  const a = catalog(tv);
  assert.deepEqual(a.seasons.map(s => s.id), ['s1', 's2']);
  assert.deepEqual(a.chapters.map(c => c.number), ['01', '03']);
  assert.equal(a.chapters[1].title, 'Original 01 B');
  assert.equal(catalog(tv, '', 'c').selectedSeasonId, 's2');
  assert.equal(catalog(tv, 'retired-season', 'c').selectedSeasonId, 's2');
  assert.equal(unitTitle(tv, 'c'), '第二季 · 第 1 集');
  assert.match(present({ ...tv, seasonCount: 2, unitCount: 3 }).metadata, /2 季 · 3 集/);
  assert.equal(recentPosition(tv, { chapterId: 'c' }, '第二季 · 第 1 集 · 第 002 句'), '电视剧 · 第二季 · 第 1 集 · 第 002 句');
});

test('a 12 season / 462 episode catalog renders only the chosen season', () => {
  const counts = [52, 53, 52, 52, 52, 38, 13, 29, 43, 26, 26, 26];
  const book = { ...tv, seasons: counts.map((_, i) => ({ id: 's' + i, title: 'Season ' + i, order: i + 1 })), chapters: counts.flatMap((n, i) => Array.from({ length: n }, (_, j) => ({ id: i + '-' + j, seasonId: 's' + i, episodeNumber: j + 1 }))) };
  const view = catalog(book, 's1');
  assert.equal(book.chapters.length, 462);
  assert.equal(view.chapters.length, 53);
  assert.ok(view.chapters.every(c => c.seasonId === 's1'));
  assert.equal(view.catalogSummary, '12 季 · 462 集');
});

test('flat TV and legacy books keep existing chapter IDs and navigation', () => {
  const flat = { ...tv, seasons: [], chapters: [{ id: 'flat-a', episodeNumber: 5 }, { id: 'flat-b', episodeNumber: 8 }] };
  assert.equal(catalog(flat).seasons.length, 0);
  assert.deepEqual(catalog(flat).chapters.map(c => c.number), ['05', '08']);
  const old = { ...tv, contentType: undefined, seasons: undefined };
  assert.equal(catalog(old).catalogLabel, '章节');
  assert.deepEqual(catalog(old).chapters.map(c => c.id), ['a', 'b', 'c']);
  assert.deepEqual(catalog(old).chapters.map(c => c.number), ['01', '02', '03']);
  assert.equal(unitTitle(old, 'c'), 'Chapter 3');
});

test('directory opens at saved season, preserves browsing choice on refresh, and continues exact saved episode', async () => {
  setup();
  progressStore.get(tv).state.progress = { bookId: tv.bookId, textRevision: tv.textRevision, chapterId: 'c', sentenceId: 'c-s2', preferredSpeed: 1 };
  const p = page('book'); p.onLoad({ bookId: tv.bookId }); await tick();
  assert.equal(p.data.selectedSeasonId, 's2');
  p.changeSeason({ detail: { value: 0 } });
  await p.load();
  assert.equal(p.data.selectedSeasonId, 's1');
  p.continueReading();
  assert.match(navigation.at(-1), /chapterId=c&sentenceId=c-s2$/);
  p.changeSeason({ detail: { value: 100 } });
  assert.equal(p.data.selectedSeasonId, 's1');
});

test('reader season browsing does not change playback; cross-season selection stops audio and same-episode selection preserves position', async () => {
  setup(); const p = page('reader'); p.onLoad({ bookId: tv.bookId, chapterId: 'c', sentenceId: 'c-s2' }); await tick();
  assert.equal(p.data.chapterLabel, '第二季 · 第 1 集');
  assert.equal(playerState.index, 1);
  let stopped = 0; player.audio = { stop() { stopped++; }, destroy() {} }; playerState.status = 'playing';
  p.showChapters(); p.changeSeason({ detail: { value: 0 } });
  assert.equal(p.data.chapter.chapterId, 'c');
  assert.deepEqual(p.data.chapterOptions.map(c => c.id), ['a', 'b']);
  assert.equal(stopped, 0);
  p.hideChapters(); p.showChapters();
  assert.equal(p.data.selectedSeasonId, 's2');
  await p.chooseChapter({ currentTarget: { dataset: { id: 'c' } } });
  assert.equal(playerState.index, 1); assert.equal(stopped, 0);
  await p.chooseChapter({ currentTarget: { dataset: { id: 'b' } } });
  assert.equal(stopped, 1); assert.equal(playerState.status, 'selected');
  assert.equal(p.data.chapterLabel, '第一季 · 第 3 集');
  assert.equal(progressStore.get(tv).state.progress.chapterId, 'b');
});

test('late cross-season response cannot overwrite final episode or write extra progress', async () => {
  setup(); const p = page('reader'); p.onLoad({ bookId: tv.bookId, chapterId: 'a' }); await tick();
  const pending = new Map(); content.chapter = (b, id) => new Promise(r => pending.set(id, r));
  const first = p.chooseChapter({ currentTarget: { dataset: { id: 'b' } } }); await tick();
  const last = p.chooseChapter({ currentTarget: { dataset: { id: 'c' } } }); await tick();
  pending.get('c')(chapter('c')); await last;
  const revision = progressStore.get(tv).state.revision;
  pending.get('b')(chapter('b')); await first;
  assert.equal(p.data.chapter.chapterId, 'c');
  assert.equal(p.data.selectedSeasonId, 's2');
  assert.equal(progressStore.get(tv).state.progress.chapterId, 'c');
  assert.equal(progressStore.get(tv).state.revision, revision);
});

test('A to B to A selection ignores the first A response even when its chapter ID matches the final selection', async () => {
  setup(); const p = page('reader'); p.onLoad({ bookId: tv.bookId, chapterId: 'c' }); await tick();
  const pending = []; content.chapter = (b, id) => new Promise(resolve => pending.push({ id, resolve }));
  const select = id => p.chooseChapter({ currentTarget: { dataset: { id } } });
  const first = select('a'); await tick(); const middle = select('b'); await tick(); const last = select('a'); await tick();
  pending[2].resolve(chapter('a')); await last;
  const revision = progressStore.get(tv).state.revision;
  pending[0].resolve(chapter('a')); await first; pending[1].resolve(chapter('b')); await middle;
  assert.equal(p.data.chapter.chapterId, 'a');
  assert.equal(progressStore.get(tv).state.revision, revision);
  assert.equal(playerState.status, 'selected');
});
