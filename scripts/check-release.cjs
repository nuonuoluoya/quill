const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
function validateConfig(project, config, app) {
  if (!/^wx[0-9a-f]{16}$/.test(project.appid || '')) throw Error('发布必须使用正式 AppID，不能使用游客项目');
  if (/\bqa\b|验收|测试|anonymous/i.test(project.projectname || '')) throw Error('当前项目名属于测试项目，请打开正式源码项目');
  if (config.environment !== 'production') throw Error('发布必须使用 production 环境');
  let url;
  try { url = new URL(config.apiBaseUrl); } catch { throw Error('生产 API 地址无效'); }
  if (url.protocol !== 'https:' || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname) || /\.(invalid|local)$/.test(url.hostname))
    throw Error('发布必须使用 HTTPS 生产 API');
  if (app.pages?.[0] !== 'pages/library/library') throw Error('首次入口必须为内容库');
}
function validateSource(filename, text) {
  if (/(?:^|[/\\])qa[-_.]/i.test(filename) ||
      /\bwx\s*(?:\.\s*(?:login|request)|\[\s*['"](?:login|request)['"]\s*\])\s*=(?!=|>)/.test(text) ||
      /mockWxMethod\s*\(\s*['"](?:login|request)['"]/.test(text) ||
      /require\s*\(\s*['"][^'"]*qa-(?:fixture|observer)(?:\.js)?['"]/.test(text))
    throw Error('发布包含测试文件或微信 API 替换：' + filename);
}
function run() {
  const root = path.resolve(__dirname, '..');
  let gitRoot;
  try { gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { throw Error('发布必须从正式 Git 源码仓库运行，不能使用临时验收副本'); }
  if (path.resolve(gitRoot).toLowerCase() !== root.toLowerCase()) throw Error('请从源码仓库根目录发布');
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  validateConfig(project, require(path.join(root, 'config/config.js')), JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')));
  const privatePath = path.join(root, 'project.private.config.json');
  if (fs.existsSync(privatePath)) {
    const local = JSON.parse(fs.readFileSync(privatePath, 'utf8'));
    if (local.projectname) validateConfig({ ...project, projectname: local.projectname }, require(path.join(root, 'config/config.js')), { pages: ['pages/library/library'] });
  }
  const ignored = new Set(['.git', '.codex', '.agents', '.codex-tools', 'node_modules', 'tests', 'scripts', 'docs']);
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (/\.(?:js|cjs)$/.test(file)) validateSource(path.relative(root, file), fs.readFileSync(file, 'utf8'));
    }
  }
  scan(root);
  require('./check.cjs');
  console.log('发布前检查通过：Git 源码目录、正式 AppID、production API、首页及运行时代码无 QA 替换。');
}
module.exports = { validateConfig, validateSource };
if (require.main === module) run();
