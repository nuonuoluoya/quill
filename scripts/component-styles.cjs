const fs = require('node:fs');
const path = require('node:path');

// Conservative preflight for our class-based WXSS. Native compilation remains
// responsible for declarations; this also checks styles pulled in via @import.
function checkComponentStyles(file, seen = new Set()) {
    file = path.resolve(file);
    if (seen.has(file)) return;
    seen.add(file);
    let css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    css = css.replace(/@import\s+(['"])([^'"]+)\1\s*;/g, (_, quote, imported) => {
        checkComponentStyles(path.resolve(path.dirname(file), imported), seen);
        return '';
    });
    const stack = [];
    let start = 0;
    for (let i = 0; i < css.length; i++) {
        if (css[i] === '{') {
            const selector = css.slice(start, i).trim();
            const frame = stack.at(-1) === 'keyframes';
            if (frame) {
                if (!/^(?:from|to|\d+(?:\.\d+)?%)(?:\s*,\s*(?:from|to|\d+(?:\.\d+)?%))*$/.test(selector))
                    throw Error(`无效组件动画选择器：${file} → ${selector}`);
            } else if (!selector.startsWith('@')) {
                // Classes, combinators and simple supported pseudo selectors.
                const remainder = selector.replace(/\.[\w-]+/g, '').replace(/::?(?:host|before|after|hover|active|focus|focus-visible|focus-within)\b/g, '').replace(/[\s,>+~]/g, '');
                if (!selector || remainder)
                    throw Error(`组件 WXSS 仅允许类选择器：${file} → ${selector}`);
            }
            stack.push(/^@(?:-\w+-)?keyframes\b/.test(selector) ? 'keyframes' : 'rule');
            start = i + 1;
        } else if (css[i] === '}') {
            stack.pop(); start = i + 1;
        }
    }
}
module.exports = { checkComponentStyles };
