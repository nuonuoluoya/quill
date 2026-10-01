const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
const book = { bookId: 'private-book', title: 'Private excerpt', visibility: 'private', contentScope: 'sample', chapters: [{ id: 'c' }] };
const { PREVIEW_BOOK_ID } = require('../utils/guest-preview');
const preview = { ...book, bookId: PREVIEW_BOOK_ID, title: 'First chapter preview', visibility: 'sample-public' };

function runtime() {
  let definition, identityChanged;
  const auth = { session: null }, calls = [], navigation = [];
  const content = {
    async list(audience) { calls.push(['list', audience]); return { items: audience === 'member' ? [book] : [preview, { ...preview, bookId: 'old-sample' }], nextCursor: null }; },
    async book(id) { calls.push(['book', id]); return book; }
  };
  const progress = { recent: () => 'private-book', get: () => ({ state: { progress: { chapterId: 'c' } } }), position: () => 'Chapter · 第 001 句' };
  const dependencies = {
    '../../models/auth': { auth, onIdentityChange: fn => { identityChanged = fn; return () => {}; } },
    '../../models/content': { content }, '../../models/progress': { progressStore: progress },
    '../../utils/http': { message: e => e.message, navigate: url => navigation.push(url) },
    '../../utils/library-presentation': require('../utils/library-presentation'),
    '../../utils/guest-preview': require('../utils/guest-preview')
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/library/library.js'), 'utf8'), {
    require: name => dependencies[name], Page: value => { definition = value; }, wx: { stopPullDownRefresh() {} }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  const identity = id => { auth.session = id ? { user: { id } } : null; identityChanged(); };
  return { page, auth, identity, content, progress, calls, navigation };
}

test('guest entry exposes only the public first-chapter preview; login switches to member content', async () => {
  const r = runtime(), p = r.page;
  p.onLoad(); p.onShow(); await p.onPullDownRefresh(); await p.changeType({ currentTarget: { dataset: { value: 'book' } } });
  assert.ok(r.calls.filter(c => c[0] === 'list').every(c => c[1] === 'sample'));
  assert.deepEqual(Array.from(p.data.books, b => b.bookId), [PREVIEW_BOOK_ID]); assert.equal(p.data.recent, null);
  p.signIn(); assert.equal(r.navigation[0], '/pages/settings/settings');
  r.identity('member'); await tick();
  assert.equal(p.data.loggedIn, true); assert.equal(p.data.books.length, 1);
  assert.ok(r.calls.some(call => call[0] === 'list' && call[1] === 'member'));
  assert.equal(p.data.recent.bookId, book.bookId); // Private excerpts remain available.
  r.identity(null); await tick();
  assert.deepEqual(Array.from(p.data.books, b => b.bookId), [PREVIEW_BOOK_ID]); assert.equal(p.data.recent, null); assert.equal(p.data.loggedIn, false);
  p.onUnload();
});

test('old public-sample progress is hidden without erasing it; member recent remains independent of list pagination', async () => {
  const r = runtime(), p = r.page; r.auth.session = { user: { id: 'member' } };
  r.progress.recent = () => 'old-sample';
  r.content.book = async () => ({ ...book, bookId: 'old-sample', visibility: 'sample-public' });
  p.onLoad(); await tick(); assert.equal(p.data.recent, null); assert.equal(r.progress.recent(), 'old-sample');
  r.content.book = async () => ({ ...book, bookId: 'later-page-private' });
  await p.loadRecent(); assert.equal(p.data.recent.bookId, 'later-page-private');
  p.onUnload();
});

test('logout loads public preview and discards late private list responses and cursor', async () => {
  const r = runtime(), p = r.page; r.auth.session = { user: { id: 'A' } };
  let resolve;
  r.content.list = audience => audience === 'member' ? new Promise(r => { resolve = r; }) : Promise.resolve({ items: [preview], nextCursor: null });
  p.onLoad(); r.identity(null); resolve({ items: [book], nextCursor: 'old-cursor' }); await tick();
  assert.deepEqual(Array.from(p.data.books, b => b.bookId), [PREVIEW_BOOK_ID]); assert.equal(p.data.nextCursor, null); assert.equal(p.data.recent, null);
  p.onUnload();
});

test('account switch discards a late recent-detail response from the previous account', async () => {
  const r = runtime(), p = r.page; r.auth.session = { user: { id: 'A' } };
  let resolve;
  r.content.book = () => new Promise(r => { resolve = r; });
  p.onLoad(); await tick();
  r.progress.recent = () => null; r.identity('B'); await tick();
  resolve(book); await tick();
  assert.equal(p.data.recent, null); assert.equal(p.data.loggedIn, true);
  p.onUnload();
});

test('guest preview is found beyond old sample pages and never exposes old samples', async () => {
  const r = runtime(), p = r.page, cursors = [];
  r.content.list = async (audience, cursor) => {
    assert.equal(audience, 'sample'); cursors.push(cursor);
    return cursor ? { items: [preview], nextCursor: 'unrelated-tail' } : { items: [{ ...preview, bookId: 'old-sample' }], nextCursor: 'preview-page' };
  };
  p.onLoad(); await tick();
  assert.deepEqual(cursors, [undefined, 'preview-page']);
  assert.deepEqual(Array.from(p.data.visibleBooks, b => b.bookId), [PREVIEW_BOOK_ID]);
  assert.equal(p.data.nextCursor, null); p.onUnload();
});

test('unavailable public preview offers retry without replacing it with another book or forcing login', async () => {
  const r = runtime(), p = r.page;
  r.content.list = async () => ({ items: [{ ...preview, bookId: 'old-sample' }], nextCursor: null });
  p.onLoad(); await tick();
  assert.equal(p.data.visibleBooks.length, 0); assert.match(p.data.error, /第一章预览暂不可用/);
  assert.equal(r.navigation.length, 0); assert.equal(r.auth.session, null); p.onUnload();
});

test('login discards late guest preview results and does not reuse the public cursor', async () => {
  const r = runtime(), p = r.page; let finish;
  r.content.list = audience => audience === 'sample' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ items: [book], nextCursor: null });
  p.onLoad(); r.identity('member'); await tick();
  finish({ items: [preview], nextCursor: 'guest-cursor' }); await tick();
  assert.deepEqual(Array.from(p.data.books, b => b.bookId), [book.bookId]); assert.equal(p.data.nextCursor, null); p.onUnload();
});
