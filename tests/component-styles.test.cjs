const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { checkComponentStyles } = require('../scripts/component-styles.cjs');
function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quill-component-wxss-'));
    t.after(() => {
        const target = fs.realpathSync(dir);
        assert.equal(path.dirname(target), fs.realpathSync(os.tmpdir()));
        assert.ok(path.basename(target).startsWith('quill-component-wxss-'));
        fs.rmSync(target, { recursive: true, force: true });
    });
    return dir;
}
test('component preflight rejects tag, id and attribute selectors, including imported styles', t => {
    const dir = fixture(t);
    const file = path.join(dir, 'component.wxss'), imported = path.join(dir, 'base.wxss');
    for (const selector of ['button', 'button[size="default"].nav-back', '.nav #back', '.button[disabled]', '.progress view', '.a,.b text']) {
        fs.writeFileSync(imported, `${selector}{color:red}`); fs.writeFileSync(file, '@import "base.wxss";.safe{display:block}');
        assert.throws(() => checkComponentStyles(file), /仅允许类选择器/);
    }
});
test('component preflight accepts class specificity, pseudo elements, media rules and keyframes', t => {
    const dir = fixture(t);
    const file = path.join(dir, 'safe.wxss');
    fs.writeFileSync(file, ':host{display:block}.button.button,.row>.item::after{border:0}.button.is-disabled{opacity:.45}@media(max-width:360px){.button{width:44px}}@keyframes enter{from{opacity:0}50%,to{opacity:1}}');
    assert.doesNotThrow(() => checkComponentStyles(file));
});
