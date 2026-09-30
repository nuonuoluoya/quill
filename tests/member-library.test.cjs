const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
const book = { bookId: 'private-book', title: 'Private excerpt', visibility: 'private', contentScope: 'sample', chapters: [{ id: 'c' }] };

function runtime() {
  let definition, identityChanged;
  const auth = { session: null }, calls = [], navigation = [];
  const content = {
    async list(audience) { calls.push(['list', audience]); return { items: [book], nextCursor: null }; },
    async book(id) { calls.push(['book', id]); return book; }
  };
  const progress = { recent: () => 'private-book', get: () => ({ state: { progress: { chapterId: 'c' } } }), position: () => 'Chapter · 第 001 句' };
  const dependencies = {
    '../../models/auth': { auth, onIdentityChange: fn => { identityChanged = fn; return () => {}; } },
    '../../models/content': { content }, '../../models/progress': { progressStore: progress },
    '../../utils/http': { message: e => e.message, navigate: url => navigation.push(url) },
    '../../utils/library-presentation': require('../utils/library-presentation')
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/library/library.js'), 'utf8'), {
    require: name => dependencies[name], Page: value => { definition = value; }, wx: { stopPullDownRefresh() {} }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  const identity = id => { auth.session = id ? { user: { id } } : null; identityChanged(); };
  return { page, auth, identity, content, progress, calls, navigation };
}

test('guest entry, refresh and filtering do not request content; login loads only member content', async () => {
  const r = runtime(), p = r.page;
  p.onLoad(); p.onShow(); await p.onPullDownRefresh(); await p.changeType({ currentTarget: { dataset: { value: 'book' } } });
  assert.equal(r.calls.length, 0); assert.equal(p.data.recent, null);
  p.signIn(); assert.equal(r.navigation[0], '/pages/settings/settings');
  r.identity('member'); await tick();
  assert.equal(p.data.loggedIn, true); assert.equal(p.data.books.length, 1);
  assert.equal(r.calls.find(call => call[0] === 'list')[1], 'member');
  assert.equal(p.data.recent.bookId, book.bookId); // Private excerpts remain available.
  r.identity(null); await tick();
  assert.equal(p.data.books.length, 0); assert.equal(p.data.recent, null); assert.equal(p.data.loggedIn, false);
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

test('logout discards late member list responses without requesting public samples', async () => {
  const r = runtime(), p = r.page; r.auth.session = { user: { id: 'A' } };
  let resolve;
  r.content.list = audience => { assert.equal(audience, 'member'); return new Promise(r => { resolve = r; }); };
  p.onLoad(); r.identity(null); resolve({ items: [book], nextCursor: 'old-cursor' }); await tick();
  assert.equal(p.data.books.length, 0); assert.equal(p.data.nextCursor, null); assert.equal(p.data.recent, null);
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
