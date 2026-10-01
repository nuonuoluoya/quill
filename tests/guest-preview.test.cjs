const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { PREVIEW_BOOK_ID, FULL_BOOK_ID, validPreview } = require('../utils/guest-preview');
const tick = () => new Promise(resolve => setImmediate(resolve));
const preview = {
  bookId: PREVIEW_BOOK_ID, buildId: 'preview-build', textRevision: 'preview-text',
  visibility: 'sample-public', contentScope: 'sample', previewOfBookId: FULL_BOOK_ID,
  chapters: [{ id: 'c01', title: 'First chapter', sentenceCount: 2, playableCount: 2 }],
  lockedChapters: Array.from({ length: 16 }, (_, i) => ({ id: 'c' + String(i + 2).padStart(2, '0'), number: i + 2, title: 'Chapter ' + (i + 2) }))
};
function runtime(name) {
  let definition, logins = 0, bookReads = 0;
  const navigation = [], auth = { session: null };
  const content = { async book() { bookReads++; return { bookId: FULL_BOOK_ID, buildId: 'full-build', chapters: [{ id: 'c02' }] }; } };
  const deps = {
    '../../models/auth': { auth, identity: () => auth.session ? 'member' : 'guest', login: async () => { logins++; auth.session = { user: { id: 'new-member' } }; }, onIdentityChange: () => () => {} },
    '../../models/content': { content }, '../../models/context': { selectedBook: { value: null } },
    '../../models/preferences': { defaultSpeed: () => 1 }, '../../models/progress': { progressStore: {} },
    '../../models/player': { player: {} }, '../../utils/contracts': { speeds: [1] },
    '../../utils/events': { subscribe: () => () => {} },
    '../../utils/http': { message: e => e.message, toLibrary: () => navigation.push('/pages/library/library'), navigate: url => navigation.push(url) },
    '../../utils/guest-preview': require('../utils/guest-preview'), '../../utils/catalog': require('../utils/catalog'),
    '../../utils/podcast': require('../utils/podcast')
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../pages/${name}/${name}.js`), 'utf8'), {
    require: key => deps[key], Page: value => { definition = value; }, wx: { redirectTo: o => navigation.push(o.url) }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(d) { Object.assign(this.data, d); } };
  return { page, auth, content, navigation, get logins() { return logins; }, get bookReads() { return bookReads; } };
}
test('preview has one accessible chapter and sixteen unique locked metadata entries', () => {
  assert.equal(validPreview(preview), true);
  for (const mutate of [b => b.chapters.push({ id: 'c02' }), b => b.lockedChapters[0].id = 'c01', b => b.lockedChapters[0].number = 3,
    b => b.lockedChapters.pop(), b => b.previewOfBookId = 'other-book', b => b.visibility = 'private']) {
    const bad = structuredClone(preview); mutate(bad); assert.equal(validPreview(bad), false);
  }
});
test('first chapter opens public preview; locked chapter routes to optional login without requesting private content', () => {
  const r = runtime('book'), p = r.page; p.data.book = preview;
  p.openChapter({ currentTarget: { dataset: { id: 'c01' } } });
  assert.match(r.navigation[0], /bookId=hp1-chapter1-preview&buildId=preview-build&chapterId=c01/);
  p.openChapter({ currentTarget: { dataset: { id: 'c02' } } });
  assert.equal(r.navigation[1], '/pages/settings/settings?returnBookId=hp1-en&returnChapterId=c02');
  assert.equal(r.bookReads, 0); assert.equal(r.logins, 0);
  p.openChapter({ currentTarget: { dataset: { id: 'unknown' } } }); assert.equal(r.navigation.length, 2);
});
test('locked chapter login requires consent and returns to the server-authorized chapter only', async () => {
  const r = runtime('settings'), p = r.page;
  p.onLoad({ returnBookId: FULL_BOOK_ID, returnChapterId: 'c02' }); p.onShow();
  await p.signIn(); assert.equal(r.logins, 0); assert.equal(r.bookReads, 0); assert.equal(p.data.consent, false);
  p.consent({ detail: { value: ['agree'] } }); await p.signIn();
  assert.equal(r.logins, 1); assert.equal(r.bookReads, 1);
  assert.match(r.navigation[0], /bookId=hp1-en&buildId=full-build&chapterId=c02/); p.onUnload();
});
test('reader chapter picker routes locked chapters to login without loading private body', async () => {
  const r = runtime('reader'), p = r.page; p.data.book = preview; p.data.sheet = true;
  await p.chooseChapter({ currentTarget: { dataset: { id: 'c02' } } });
  assert.equal(p.data.sheet, false); assert.equal(r.bookReads, 0); assert.equal(r.logins, 0);
  assert.equal(r.navigation[0], '/pages/settings/settings?returnBookId=hp1-en&returnChapterId=c02');
});
test('cancelled login and an unloaded settings page cannot navigate on late authorization response', async () => {
  for (const cancel of [p => p.experience(), p => p.onUnload()]) {
    const r = runtime('settings'), p = r.page; let finish;
    r.content.book = () => new Promise(resolve => { finish = resolve; });
    p.onLoad({ returnBookId: FULL_BOOK_ID, returnChapterId: 'c02' }); p.onShow(); p.consent({ detail: { value: ['agree'] } });
    const login = p.signIn(); await tick(); cancel(p);
    finish({ bookId: FULL_BOOK_ID, buildId: 'full', chapters: [{ id: 'c02' }] }); await login;
    assert.ok(!r.navigation.some(url => url.includes('/reader/')));
    if (p.alive) p.onUnload();
  }
});
test('login does not bypass denied book access or silently choose a different chapter', async () => {
  for (const read of [async () => { throw Error('没有此内容权限'); }, async () => ({ bookId: FULL_BOOK_ID, chapters: [{ id: 'other' }] })]) {
    const r = runtime('settings'), p = r.page; r.content.book = read;
    p.onLoad({ returnBookId: FULL_BOOK_ID, returnChapterId: 'c02' }); p.onShow(); p.consent({ detail: { value: ['agree'] } }); await p.signIn();
    assert.ok(p.data.error); assert.equal(r.navigation.length, 0); assert.equal(p.data.busy, false); p.onUnload();
  }
});
test('already logged-in readers reuse existing authorization; unrelated return targets are ignored', async () => {
  const r = runtime('settings'), p = r.page; r.auth.session = { user: { id: 'existing' } };
  p.onLoad({ returnBookId: FULL_BOOK_ID, returnChapterId: 'c02' }); p.onShow(); await tick();
  assert.equal(r.logins, 0); assert.match(r.navigation[0], /chapterId=c02/); p.onUnload();
  const other = runtime('settings'); other.page.onLoad({ returnBookId: 'other-private-book', returnChapterId: 'c02' });
  assert.equal(other.page.data.hasReturnChapter, false); other.page.onUnload();
});
