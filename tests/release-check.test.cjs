const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig, validateSource } = require('../scripts/check-release.cjs');
const project = { appid: 'wx0123456789abcdef', projectname: 'Quill' };
const config = { environment: 'production', apiBaseUrl: 'https://example.com/v1' };
const app = { pages: ['pages/library/library'] };

test('release accepts production source configuration and ordinary SDK calls', () => {
  assert.doesNotThrow(() => validateConfig(project, config, app));
  assert.doesNotThrow(() => validateSource('models/auth.js', "wx.login({ success: resolve }); require('../utils/login-error');"));
});
test('release rejects tourist/QA projects, nonproduction configuration and login entry pages', () => {
  for (const override of [{ appid: 'touristappid' }, { projectname: 'Quill Podcast QA' }])
    assert.throws(() => validateConfig({ ...project, ...override }, config, app));
  for (const override of [{ environment: 'development' }, { apiBaseUrl: 'http://example.com/v1' }, { apiBaseUrl: 'https://localhost/v1' }])
    assert.throws(() => validateConfig(project, { ...config, ...override }, app));
  assert.throws(() => validateConfig(project, config, { pages: ['pages/settings/settings'] }));
});
test('release rejects QA observer/fixtures and SDK stubs', () => {
  assert.throws(() => validateSource('qa-observer.js', ''));
  for (const source of [
    'wx.login = options => options.fail({});',
    "wx['request'] = mock;",
    "require('./qa-observer');",
    "require('./qa-fixture.js');",
    "app.mockWxMethod('login', () => ({}));"
  ]) assert.throws(() => validateSource('app.js', source));
});
