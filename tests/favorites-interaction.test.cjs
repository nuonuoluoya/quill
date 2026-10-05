const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SentenceSwipe } = require('../utils/sentence-swipe');
const { FavoritePractice, referenceKey } = require('../core/favorite-practice');
const { Player, initialPlayer } = require('../core/player');
const touch = (x, y = 0) => [{ clientX: x, clientY: y }];
const tick = () => new Promise(resolve => setImmediate(resolve));
test('left swipe reveals, right swipe closes; vertical, long hold and multi-touch leave native gestures intact', () => {
  const swipe = new SentenceSwipe();
  swipe.start(touch(100), false, 0); swipe.move(touch(50), 60); assert.equal(swipe.end(100), true);
  swipe.start(touch(50), true, 0); swipe.move(touch(100), 60); assert.equal(swipe.end(100), false);
  for (const [next, elapsed] of [[touch(40, 80), 60], [touch(40), 450], [touch(96), 60], [[...touch(40), ...touch(50)], 60]]) {
    swipe.start(touch(100), false, 0); swipe.move(next, elapsed); assert.equal(swipe.end(elapsed + 10), null);
  }
  swipe.start(touch(100), false, 0); swipe.move(touch(70, 60), 50); swipe.move(touch(0, 62), 70); assert.equal(swipe.end(100), null);
});
test('sentence component reveals without saving, star requests a controlled change, long press does not play', () => {
  let definition; global.Component = value => definition = value;
  require('../components/sentence-row/sentence-row'); delete global.Component;
  const events = [], c = { ...definition.methods, setData() {}, properties: { item: { id: 's', available: true, saved: false } }, triggerEvent: (name, detail) => events.push({ name, detail }) };
  definition.lifetimes.attached.call(c);
  c.start({ touches: touch(100) }); c.move({ touches: touch(20) }); c.end(); c.play();
  assert.deepEqual(events.map(e => e.name), ['reveal']); assert.equal(c.properties.item.saved, false);
  c.start({ touches: touch(100) }); c.end(); c.favorite(); assert.deepEqual(events.at(-1), { name: 'favorite', detail: { id: 's', saved: true } }); assert.equal(c.properties.item.saved, false);
  c.properties.pending = true; c.favorite(); assert.equal(events.length, 2);
  c.start({ touches: touch(100) }); c.hold(); c.play(); assert.equal(events.length, 2);
  c.properties.disabled = true; c.start({ touches: touch(100) }); c.play(); c.favorite(); assert.equal(events.length, 2);
});
function fixture(bookId, sentenceId = 's2') {
  const book = { bookId, buildId: 'build', textRevision: 'text' };
  const chapter = { ...book, chapterId: 'c1', sentences: [1, 2, 3].map(index => ({ id: 's' + index, index, text: 'Synthetic sentence ' + index, audioId: 'a' + index, duration: 2, alignment: { status: 'verified' } })) };
  return { item: { ...book, chapterId: 'c1', sentenceId, available: true }, target: { book, chapter, sentence: chapter.sentences.find(s => s.id === sentenceId) } };
}
function setup(resolve) {
  const audio = [], requests = [], errors = [];
  const state = initialPlayer(); let progressWrites = 0;
  const player = new Player(state, () => {
    const events = {}, a = { events, playbackRate: 1, currentTime: 0, play() { events.Play(); }, pause() { events.Pause?.(); }, stop() {}, destroy() {} };
    for (const key of ['Canplay', 'Play', 'Pause', 'Ended', 'TimeUpdate', 'Error', 'Waiting', 'Seeked']) a['on' + key] = fn => { events[key] = fn; };
    audio.push(a); return a;
  }, async (book, sentenceId, mode) => { requests.push([book.bookId, sentenceId, mode]); return { audioId: 'a', url: 'https://fixture.invalid/a.mp3', duration: 2, issuedAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-01T01:00:00Z' }; });
  player.onSelection = () => progressWrites++;
  const practice = new FavoritePractice({ player, state, resolve, failed: e => errors.push(e.message) }); practice.attach();
  return { player, practice, state, audio, requests, errors, get progressWrites() { return progressWrites; } };
}
test('cross-source continuous playback uses real sentence identities without source progress or uncollected neighbors', async () => {
  const a = fixture('A'), b = fixture('B', 's1'), fixtures = [a, b];
  const r = setup(async item => fixtures.find(f => referenceKey(f.item) === referenceKey(item)).target);
  try {
    await r.practice.choose(a.item, [a.item, b.item]); await tick(); r.audio.at(-1).events.Canplay();
    assert.equal(r.state.index, 1); assert.equal(r.player.chapter, a.target.chapter); assert.equal(r.progressWrites, 0);
    r.player.setContinuous(true); r.audio.at(-1).events.Ended(); await tick();
    assert.deepEqual(r.requests, [['A', 's2', 'sentence'], ['B', 's1', 'sentence']]); assert.equal(r.practice.index(), 1);
    r.audio.at(-1).events.Canplay(); r.audio.at(-1).events.Ended(); await tick();
    assert.equal(r.requests.length, 2); assert.equal(r.state.status, 'ended'); assert.equal(r.progressWrites, 0);
  } finally { r.practice.detach(); }
});
test('search does not replace the active queue; selecting does; removing another favorite leaves audio running', async () => {
  const a = fixture('A'), b = fixture('B'); const r = setup(async item => item.bookId === 'A' ? a.target : b.target);
  try {
    const results = [a.item, b.item]; await r.practice.choose(a.item, results); await tick(); r.audio.at(-1).events.Canplay();
    results.splice(0, 1); assert.equal(r.practice.queue.length, 2); assert.equal(r.state.status, 'playing');
    r.practice.remove(b.item); assert.equal(r.state.status, 'playing'); assert.equal(r.practice.current.bookId, 'A');
    r.practice.remove(a.item); assert.equal(r.practice.current, null); assert.equal(r.player.audio, null);
    await r.practice.choose(b.item, [b.item]); assert.equal(r.practice.queue.length, 1);
  } finally { r.practice.detach(); }
});
test('late resolution after switching, removing current or leaving cannot start playback', async () => {
  const a = fixture('A'), b = fixture('B'), pending = []; const r = setup(item => new Promise(resolve => pending.push({ item, resolve })));
  try {
    const first = r.practice.choose(a.item, [a.item, b.item]), second = r.practice.choose(b.item, [a.item, b.item]);
    pending[1].resolve(b.target); await second; pending[0].resolve(a.target); await first;
    assert.equal(r.practice.current.bookId, 'B'); assert.deepEqual(r.requests.map(x => x[0]), ['B']);
    const third = r.practice.choose(a.item, [a.item]); r.practice.remove(a.item); pending[2].resolve(a.target); await third;
    assert.equal(r.practice.current, null); assert.equal(r.requests.length, 1);
    const fourth = r.practice.choose(b.item, [b.item]); r.practice.detach(); pending[3].resolve(b.target); await fourth;
    assert.equal(r.requests.length, 1);
  } finally { r.practice.detach(); }
});
test('changed text revision is not silently migrated, but a new audio build retains the stable identity', async () => {
  const a = fixture('A'); let target = { ...a.target, book: { ...a.target.book, textRevision: 'new-text' } }; const r = setup(async () => target);
  try {
    await r.practice.choose(a.item, [a.item]); assert.equal(r.requests.length, 0); assert.equal(r.errors.length, 1);
    target = { ...a.target, book: { ...a.target.book, buildId: 'new-audio' } }; await r.practice.choose(a.item, [a.item]);
    assert.equal(r.player.book.buildId, 'new-audio'); assert.equal(r.requests.length, 1);
  } finally { r.practice.detach(); }
});
test('a hidden favorites page unloading later does not dispose the next reader player', async () => {
  const a = fixture('A'), b = fixture('B'), r = setup(async () => a.target);
  await r.practice.choose(a.item, [a.item]); r.practice.detach();
  r.player.load(b.target.book, b.target.chapter, 0); await r.player.start();
  const audio = r.player.audio; r.practice.detach();
  assert.equal(r.player.audio, audio); assert.equal(r.player.book.bookId, 'B'); r.player.dispose();
});
