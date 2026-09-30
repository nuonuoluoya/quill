const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

// A fresh module graph represents a full compile/restart after changing config.
function runtime(environment, storage) {
  const modules = new Map(), requests = [], reads = [];
  let logins = 0;
  const wx = {
    getStorageSync(key) { reads.push(key); return structuredClone(storage.get(key)); },
    setStorageSync(key, value) { storage.set(key, structuredClone(value)); },
    removeStorageSync(key) { storage.delete(key); },
    getStorageInfoSync() { return { keys: [...storage.keys()] }; },
    login(o) { logins++; o.success({ code: 'fresh-test-code' }); },
    request(o) {
      requests.push(o);
      assert.equal(new URL(o.url).origin, `https://${environment}.invalid`);
      if (o.url.endsWith('/auth/wechat')) {
        o.success({ statusCode: 200, data: { data: { user: { id: 'same-user' }, accessToken: 'production-test-token', expiresAt: '2099-01-01T00:00:00Z' } } });
      } else if (o.url.endsWith('/auth/session') && o.method === 'DELETE') {
        o.success({ statusCode: 200, data: { data: {} } });
      } else if (o.url.endsWith('/me')) {
        o.success({ statusCode: 200, data: { data: { id: 'same-user' } } });
      } else throw Error(`Unexpected network request: ${o.method} ${o.url}`);
    },
  };
  const context = vm.createContext({ wx, setTimeout, clearTimeout, console });
  function load(file) {
    const absolute = path.resolve(root, file.endsWith('.js') ? file : file + '.js');
    if (absolute === path.join(root, 'config/config.js'))
      return { environment, apiBaseUrl: `https://${environment}.invalid` };
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} }; modules.set(absolute, module);
    const fn = vm.runInContext(`(function(require,module,exports){${fs.readFileSync(absolute, 'utf8')}\n})`, context);
    fn(name => load(path.resolve(path.dirname(absolute), name)), module, module.exports);
    return module.exports;
  }
  return { load, requests, reads, get logins() { return logins; } };
}

test('production cold start ignores development session, guest data and queued writes; login uses a fresh code', async () => {
  const storage = new Map();
  const book = { bookId: 'b', textRevision: 'r', chapters: [{ id: 'c', title: 'Chapter' }] };
  const dev = runtime('development', storage);
  const auth = dev.load('models/auth');
  auth.auth.session = { user: { id: 'same-user' }, accessToken: 'development-test-token', expiresAt: '2099-01-01T00:00:00Z' };
  storage.set('pidan:development:session', structuredClone(auth.auth.session));
  storage.set('pidan:development:same-user:recent', 'private-development-book');
  storage.set('pidan:development:same-user:speed', 1.5);
  storage.set('pidan:development:guest:recent', 'guest-development-book');
  storage.set('pidan:development:guest:speed', 1.25);
  const record = dev.load('models/progress').progressStore.get(book);
  record.update({ bookId: 'b', textRevision: 'r', sourceBuildId: 'dev-build', chapterId: 'c', sentenceId: 's', preferredSpeed: 1 });
  record.state.inflight = { kind: 'put', body: { textRevision: 'r', expectedVersion: 0, clientMutationId: 'development-pending' } };
  record.persist(); record.stop();
  const before = JSON.stringify([...storage]);

  const prod = runtime('production', storage);
  const productionAuth = prod.load('models/auth');
  const progress = prod.load('models/progress').progressStore;
  assert.equal(productionAuth.auth.session, null);
  assert.equal(progress.recent(), null);
  assert.equal(prod.load('models/preferences').defaultSpeed(), 1);
  progress.resume();
  assert.equal(progress.hasPending(), false);
  assert.equal(prod.requests.length, 0);
  assert.equal(JSON.stringify([...storage]), before);

  await productionAuth.login();
  await productionAuth.api('/me');
  progress.resume();
  assert.equal(prod.logins, 1);
  assert.equal(prod.requests[0].data.code, 'fresh-test-code');
  assert.equal(prod.requests[0].header.Authorization, undefined);
  assert.equal(prod.requests[1].header.Authorization, 'Bearer production-test-token');
  assert.equal(progress.recent(), null);
  assert.equal(progress.get(book).state.dirty, false);
  assert.equal(progress.get(book).state.inflight, undefined);
  assert.equal(progress.get(book).state.progress, null);
  assert.equal(prod.load('models/preferences').defaultSpeed(), 1);
  assert.ok(prod.reads.every(key => key.startsWith('pidan:production:')));
  await productionAuth.logout();
  assert.equal(JSON.stringify([...storage]), before);
});
