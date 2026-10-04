const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { checkComponentStyles } = require('./component-styles.cjs');
const root = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const ignored = new Set(['frontend', 'contracts', '.codex-tools', 'node_modules', '.git']);
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => ignored.has(e.name) ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
const files = walk(root);
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif', '.bmp', '.ico', '.tif', '.tiff', '.heic', '.heif', '.apng', '.jfif']);
const maxImageBytes = 200000;
let imageCount = 0;
let checked = 0;
for (const file of files) {
    if (imageExtensions.has(path.extname(file).toLowerCase())) {
        const bytes = fs.statSync(file).size;
        if (bytes > maxImageBytes)
            throw Error(`图片超过 200 KB：${path.relative(root, file)}，${bytes} 字节，上限 ${maxImageBytes} 字节；请先压缩。`);
        imageCount++;
        continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.json')) {
        const cfg = JSON.parse(text);
        if (cfg.component === true) checkComponentStyles(file.slice(0, -5) + '.wxss');
        for (const value of Object.values(cfg.usingComponents || {})) {
            const component = value.startsWith('/') ? path.join(root, value) : path.resolve(path.dirname(file), value);
            for (const ext of ['.js', '.json', '.wxml', '.wxss'])
                if (!fs.existsSync(component + ext))
                    throw Error('缺少组件文件 ' + component + ext);
        }
    }
    if (file.endsWith('.js')) {
        new vm.Script(text, { filename: file });
        if (/\buni\.|from ['"]vue|import\.meta/.test(text))
            throw Error('遗留框架引用 ' + file);
        for (const match of text.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
            if (match[1].startsWith('.') && !fs.existsSync(path.resolve(path.dirname(file), match[1] + '.js')))
                throw Error('无效模块引用 ' + file + ' ' + match[1]);
        }
        checked++;
    }
}
for (const page of app.pages)
    for (const ext of ['.js', '.json', '.wxml', '.wxss'])
        if (!fs.existsSync(path.join(root, page + ext)))
            throw Error('缺少页面文件 ' + page + ext);
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
if (config.miniprogramRoot !== './')
    throw Error('小程序入口必须为根目录');
// 模板中使用的组件必须有显式依赖，防止迁移后出现标签存在但组件未注册。
const dependencies = new Map();
for (const file of files.filter(file => file.endsWith('.wxml'))) {
    const componentPath = file.slice(0, -5);
    const cfg = JSON.parse(fs.readFileSync(componentPath + '.json', 'utf8'));
    const using = cfg.usingComponents || {};
    const template = fs.readFileSync(file, 'utf8');
    for (const [, , src] of template.matchAll(/<image\b[^>]*\bsrc\s*=\s*(['"])([^'"]+)\1/gi)) {
        if (src.includes('{{') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src)) continue;
        const local = src.split(/[?#]/)[0];
        const image = local.startsWith('/') ? path.join(root, local) : path.resolve(path.dirname(file), local);
        if (!fs.existsSync(image) || !fs.statSync(image).isFile())
            throw Error(`缺少模板图片文件：${file} → ${src}`);
    }
    for (const [, tag] of template.matchAll(/<(q-[\w-]+)(?=[\s/>])/g)) {
        if (!using[tag]) throw Error(`模板组件未在当前 JSON 声明：${file} → ${tag}`);
    }
    dependencies.set(componentPath, Object.values(using).map(value =>
        value.startsWith('/') ? path.join(root, value) : path.resolve(path.dirname(file), value)));
}
const visited = new Set();
function visit(node, stack = []) {
    if (stack.includes(node)) throw Error('组件依赖出现循环：' + [...stack, node].join(' → '));
    if (visited.has(node)) return;
    for (const dependency of dependencies.get(node) || []) visit(dependency, [...stack, node]);
    visited.add(node);
}
for (const node of dependencies.keys()) visit(node);
console.log(`通过：${app.pages.length} 个原生页面，${checked} 个 JS 文件，JSON / 模块 / 组件 / 静态图片引用有效；${imageCount} 张图片均不超过 200 KB（${maxImageBytes} 字节）。`);
