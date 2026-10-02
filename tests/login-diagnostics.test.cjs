const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loginFailure } = require('../utils/login-error');

function runtime() {
  const calls = [], logs = [], requests = [], saved = [];
  const module = { exports: {} };
  class ApiError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const http = {
    environment: 'test', ApiError,
    storage: { get() {}, set(...args) { saved.push(args); } },
    async request(...args) {
      requests.push(args);
      return { user: { id: 'test-user' }, accessToken: 'test-token', expiresAt: '2099-01-01' };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../models/auth.js'), 'utf8'), {
    exports: module.exports, module,
    require(name) {
      if (name === '../utils/events') return { observable: value => value };
      if (name === '../utils/http') return http;
      if (name === '../utils/login-error') return { loginFailure };
      throw Error('Unexpected module: ' + name);
    },
    wx: { login(options) { calls.push(options); } },
    console: { warn(...args) { logs.push(args); } }
  });
  return { auth: module.exports, calls, logs, requests, saved };
}

test('SDK failures have safe categories and never disclose raw error fields', () => {
  for (const [errMsg, code] of [
    ['login:fail timeout', 'WX_LOGIN_TIMEOUT'],
    ['login:fail network unavailable', 'WX_LOGIN_NETWORK'],
    ['Anonymous QA does not log in', 'WX_LOGIN_TEST_PACKAGE'],
    ['login:fail unknown', 'WX_LOGIN_FAILED']
  ]) {
    const result = loginFailure({ errMsg: errMsg + ' secret-code', errCode: -1, code: 'secret-code', token: 'secret-token' });
    assert.equal(result.code, code);
    assert.equal(result.diagnostic.sdkCode, -1);
    assert.doesNotMatch(JSON.stringify(result), /secret-code|secret-token/);
  }
  assert.equal(loginFailure(null).code, 'WX_LOGIN_FAILED');
  assert.equal(loginFailure({ errno: 'sensitive-value' }).diagnostic.sdkCode, null);
});

test('failed SDK login does not call backend; error is actionable and a manual retry can succeed', async () => {
  const r = runtime();
  const pending = r.auth.login();
  assert.equal(r.calls[0].timeout, 10000);
  r.calls[0].fail({ errMsg: 'login:fail timeout secret-code', errno: 1001, accessToken: 'secret-token' });
  await assert.rejects(pending, { code: 'WX_LOGIN_TIMEOUT' });
  assert.equal(r.requests.length, 0);
  assert.equal(r.saved.length, 0);
  assert.equal(r.auth.auth.busy, false);
  assert.match(r.auth.auth.error, /WX_LOGIN_TIMEOUT/);
  assert.doesNotMatch(JSON.stringify(r.logs), /secret-code|secret-token/);
  const retry = r.auth.login();
  r.calls[1].success({ code: 'retry-code' });
  await retry;
  assert.equal(r.requests.length, 1);
  assert.equal(r.auth.auth.error, '');
});

test('concurrent login clicks share one SDK request and exchange code only once', async () => {
  const r = runtime();
  const first = r.auth.login(), second = r.auth.login();
  assert.equal(r.calls.length, 1);
  r.calls[0].success({ code: 'fresh-code' });
  await Promise.all([first, second]);
  assert.equal(r.requests.length, 1);
  assert.deepEqual(Array.from(r.requests[0]).slice(0, 2), ['/auth/wechat', 'POST']);
  assert.equal(r.requests[0][2].code, 'fresh-code');
  assert.equal(r.saved.length, 1);
  assert.equal(r.logs.length, 0);
});
