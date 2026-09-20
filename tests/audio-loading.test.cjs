const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Player, initialPlayer } = require('../core/player');
const { sentenceAudio } = require('../utils/sentence-audio');
const tick = () => new Promise(resolve => setImmediate(resolve));
const book = { bookId: 'b', buildId: 'v', textRevision: 'r' };
const chapter = { ...book, chapterId: 'c', chapterAudio: { status: 'available', duration: 30 },
  sentences: [1, 2].map(i => ({ id: 's' + i, index: i, duration: 5, audioId: 'a' + i, alignment: { status: 'verified', reasons: [] } })) };
const grant = { audioId: 'a', duration: 5, url: 'https://media.invalid/signed.mp3', issuedAt: '2026-09-01T00:00:00Z', expiresAt: '2026-09-01T01:00:00Z' };

function harness(t) {
  const downloads = [], natives = [], removed = [];
  let authorizations = 0;
  const wxApi = {
    downloadFile(options) {
      const task = { options, aborted: false, abort() { this.aborted = true; options.fail({ errMsg: 'aborted' }); } };
      downloads.push(task);
      return task;
    },
    getFileSystemManager: () => ({ unlink: ({ filePath }) => removed.push(filePath) })
  };
  const factory = ({ mode }) => {
    const native = { src: '', autoplay: false, loop: false, obeyMuteSwitch: true, playbackRate: 1, currentTime: 0, plays: 0, seeks: [], events: {},
      play() { this.plays++; }, pause() { this.events.Pause?.(); }, stop() {}, destroy() { this.destroyed = true; },
      seek(time) { this.seeks.push(time); this.currentTime = time; this.events.Seeked?.(); } };
    for (const name of ['Canplay', 'Play', 'Pause', 'Ended', 'Error', 'TimeUpdate', 'Seeked', 'Waiting']) native['on' + name] = fn => { native.events[name] = fn; };
    natives.push(native);
    return mode === 'sentence' ? sentenceAudio(wxApi, native) : native;
  };
  const player = new Player(initialPlayer(), factory, async () => { authorizations++; return grant; });
  player.load(book, chapter);
  t.after(() => player.dispose());
  return { player, downloads, natives, removed, get authorizations() { return authorizations; } };
}
const complete = (task, path = 'wxfile://current.mp3') => task.options.success({ statusCode: 200, tempFilePath: path });

test('single sentence stays silent until the complete download; repeated canplay starts only once before delayed play event', async t => {
  const h = harness(t);
  await h.player.start();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.natives[0].src, '');
  assert.equal(h.natives[0].plays, 0);
  assert.equal(h.player.state.status, 'loading');
  complete(h.downloads[0]);
  assert.equal(h.natives[0].src, 'wxfile://current.mp3');
  h.natives[0].events.Canplay();
  h.natives[0].events.Canplay();
  assert.equal(h.natives[0].plays, 1);
  assert.equal(h.player.state.status, 'loading');
  h.natives[0].events.Play();
  assert.equal(h.player.state.status, 'playing');
});

for (const cancel of ['pause', 'background', 'select', 'dispose']) {
  test(`cancel during sentence download (${cancel}) aborts and discards late success`, async t => {
    const h = harness(t);
    await h.player.start();
    if (cancel === 'background') h.player.setForeground(false);
    else if (cancel === 'select') h.player.select(1);
    else h.player[cancel]();
    assert.equal(h.downloads[0].aborted, true);
    complete(h.downloads[0], 'wxfile://late.mp3');
    assert.equal(h.natives[0].src, '');
    assert.equal(h.natives[0].plays, 0);
    assert.deepEqual(h.removed, ['wxfile://late.mp3']);
    assert.equal(h.authorizations, 1);
  });
}

test('HTTP download errors retry once, never feed an error body to the audio decoder, and clean temporary files', async t => {
  const h = harness(t);
  await h.player.start();
  h.downloads[0].options.success({ statusCode: 403, tempFilePath: 'wxfile://error-1' });
  await tick();
  assert.equal(h.authorizations, 2);
  h.downloads[1].options.success({ statusCode: 500, tempFilePath: 'wxfile://error-2' });
  await tick();
  assert.equal(h.downloads.length, 2);
  assert.equal(h.player.state.status, 'error');
  assert.ok(h.natives.every(a => a.src === '' && a.plays === 0));
  assert.deepEqual(h.removed, ['wxfile://error-1', 'wxfile://error-2']);
});

test('network failure uses the same bounded retry and a cancelled retry cannot start', async t => {
  const h = harness(t);
  await h.player.start();
  h.downloads[0].options.fail({ errMsg: 'timeout' });
  await tick();
  assert.equal(h.authorizations, 2);
  h.player.pause();
  complete(h.downloads[1], 'wxfile://retry-late.mp3');
  assert.ok(h.natives.every(a => a.plays === 0));
  assert.ok(h.removed.includes('wxfile://retry-late.mp3'));
});

test('pause retains only current audio, resumes without downloading, and switching sentence releases it', async t => {
  const h = harness(t);
  await h.player.start();
  complete(h.downloads[0]);
  h.natives[0].events.Canplay(); h.natives[0].events.Play();
  h.player.pause();
  assert.equal(h.removed.length, 0);
  await h.player.start();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.natives[0].plays, 2);
  h.natives[0].events.Play();
  h.player.select(1, true);
  await tick();
  assert.deepEqual(h.removed, ['wxfile://current.mp3']);
  assert.equal(h.downloads.length, 2);
  h.natives[0].events.Canplay(); h.natives[0].events.Ended();
  assert.equal(h.natives[1].plays, 0);
  assert.equal(h.player.state.index, 1);
});

test('retry seeks to the last confirmed position only once despite repeated canplay', async t => {
  const h = harness(t);
  await h.player.start(); complete(h.downloads[0]);
  h.natives[0].events.Canplay(); h.natives[0].events.Play();
  h.natives[0].currentTime = 2; h.natives[0].events.TimeUpdate();
  h.natives[0].events.Error();
  await tick(); complete(h.downloads[1], 'wxfile://retry.mp3');
  h.natives[1].events.Canplay(); h.natives[1].events.Canplay();
  assert.deepEqual(h.natives[1].seeks, [2]);
  assert.equal(h.natives[1].plays, 1);
  assert.equal(h.player.state.currentTime, 2);
});

test('chapter playback remains streaming; buffering does not issue another play and can be paused', async t => {
  const h = harness(t);
  h.player.chapterPlay(); await tick();
  assert.equal(h.downloads.length, 0);
  assert.equal(h.natives[0].src, grant.url);
  h.natives[0].events.Canplay(); h.natives[0].events.Play();
  h.natives[0].events.Waiting();
  assert.equal(h.player.state.buffering, true);
  h.natives[0].events.Canplay();
  assert.equal(h.natives[0].plays, 1);
  h.natives[0].currentTime = 1; h.natives[0].events.TimeUpdate();
  assert.equal(h.player.state.buffering, false);
  h.natives[0].events.Waiting(); h.player.pause();
  assert.equal(h.player.state.buffering, false);
  h.natives[0].events.Canplay();
  assert.equal(h.natives[0].plays, 1);
});

test('missing temp path fails with exactly one retry', async t => {
  const h = harness(t);
  await h.player.start();
  complete(h.downloads[0], ''); await tick();
  complete(h.downloads[1], ''); await tick();
  assert.equal(h.authorizations, 2);
  assert.equal(h.player.state.status, 'error');
  assert.ok(h.natives.every(a => a.src === '' && a.plays === 0));
});
test('old download arriving after new selection cannot replace the new source', async t => {
  const h = harness(t);
  await h.player.start();
  h.player.select(1, true); await tick();
  complete(h.downloads[1], 'wxfile://new.mp3');
  complete(h.downloads[0], 'wxfile://old.mp3');
  assert.equal(h.natives[1].src, 'wxfile://new.mp3');
  assert.equal(h.natives[0].src, '');
  assert.deepEqual(h.removed, ['wxfile://old.mp3']);
});
test('asynchronous seeked and canplay do not restart playback twice', async t => {
  const h = harness(t);
  h.player.state.currentTime = 2;
  await h.player.start(); complete(h.downloads[0]);
  const a = h.natives[0];
  a.seek = time => { a.currentTime = time; a.seeks.push(time); };
  a.events.Canplay(); a.events.Canplay();
  assert.deepEqual(a.seeks, [2]); assert.equal(a.plays, 0);
  a.events.Seeked(); a.events.Canplay(); a.events.Seeked();
  assert.equal(a.plays, 1);
});
test('cancel while waiting for seeked prevents delayed playback', async t => {
  const h = harness(t);
  h.player.state.currentTime = 2;
  await h.player.start(); complete(h.downloads[0]);
  const a = h.natives[0];
  a.seek = time => { a.currentTime = time; };
  a.events.Canplay(); h.player.pause();
  a.events.Seeked(); a.events.Canplay();
  assert.equal(a.plays, 0);
  assert.deepEqual(h.removed, ['wxfile://current.mp3']);
});
test('silent hanging download obeys shared 15 second deadline and bounded retry', async t => {
  const intervals = new Set();
  const originalSet = global.setInterval, originalClear = global.clearInterval;
  let now = 0;
  global.setInterval = callback => { intervals.add(callback); return callback; };
  global.clearInterval = callback => intervals.delete(callback);
  const h = harness(t);
  h.player.now = () => now;
  try {
    await h.player.start();
    now += 15500; for (const callback of [...intervals]) callback(); await tick();
    assert.equal(h.downloads[0].aborted, true);
    assert.equal(h.downloads.length, 2);
    now += 15500; for (const callback of [...intervals]) callback(); await tick();
    assert.equal(h.downloads[1].aborted, true);
    assert.equal(h.player.state.status, 'error');
    assert.equal(h.authorizations, 2);
  } finally {
    h.player.dispose();
    global.setInterval = originalSet;
    global.clearInterval = originalClear;
  }
});
