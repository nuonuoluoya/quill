const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  let definition, listener, now = 0, serial = 0, pauses = 0, writes = 0;
  const timers = new Map();
  const state = { status: 'selected', mode: 'sentence', index: 0, buffering: false, error: '', speedSupported: true };
  const context = {
    Component(value) { definition = value; },
    require(name) {
      if (name.endsWith('/player')) return { playerState: state, player: { pause() { pauses++; state.status = 'paused'; state.buffering = false; listener?.(); } } };
      if (name.endsWith('/contracts')) return { speeds: [1], timeLabel: () => '00:00' };
      if (name.endsWith('/events')) return { subscribe(fn) { listener = fn; return () => { listener = null; }; } };
      throw Error('Unexpected dependency');
    },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../components/player-dock/player-dock.js'), 'utf8'), context);
  const component = {
    ...definition.methods,
    properties: { chapter: { bookId: 'b', buildId: 'v', chapterId: 'c1', sentences: [{}] } },
    data: structuredClone(definition.data),
    setData(value) { writes++; Object.assign(this.data, value); }
  };
  definition.lifetimes.attached.call(component);
  return {
    c: component, timers, get pauses() { return pauses; }, get writes() { return writes; },
    change(value) { Object.assign(state, value); listener?.(); },
    tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      now = end;
    },
    hide() { definition.pageLifetimes.hide.call(component); },
    show() { definition.pageLifetimes.show.call(component); },
    detach() { definition.lifetimes.detached.call(component); }
  };
}

test('short loading never opens a modal, including after its old deadline', () => {
  const r = setup(); r.change({ status: 'loading' }); r.tick(999);
  assert.equal(r.c.data.loadingModal, false);
  r.change({ status: 'playing' }); r.tick(1001);
  assert.equal(r.c.data.loadingModal, false); assert.equal(r.timers.size, 0);
});

test('persistent loading opens at one second; progress updates do not postpone it; ready closes it', () => {
  const r = setup(); r.change({ status: 'loading' });
  for (let i = 1; i <= 9; i++) { r.tick(100); r.change({ currentTime: i }); }
  r.tick(99); assert.equal(r.c.data.loadingModal, false);
  r.tick(1); assert.equal(r.c.data.loadingModal, true);
  r.change({ status: 'playing' }); assert.equal(r.c.data.loadingModal, false);
});

test('chapter buffering has the same delay, and cancelling invokes pause without restarting', () => {
  const r = setup(); r.change({ mode: 'chapter', status: 'playing', buffering: true });
  r.tick(999); assert.equal(r.c.data.loadingModal, false);
  r.tick(1); assert.equal(r.c.data.loadingModal, true); assert.equal(r.c.data.loadingKind, 'buffering');
  r.c.cancelLoading(); assert.equal(r.pauses, 1); assert.equal(r.c.data.loadingModal, false);
  r.tick(2000); assert.equal(r.c.data.loadingModal, false); assert.equal(r.timers.size, 0);
});

test('success, pause, failure and unavailable state close visible modals or cancel pending ones', () => {
  for (const elapsed of [500, 1000]) for (const next of [
    { status: 'playing', buffering: false }, { status: 'paused' },
    { error: 'test failure' }, { status: 'unavailable' }, { status: 'selected' }
  ]) {
    const r = setup(); r.change({ status: 'loading' }); r.tick(elapsed);
    r.change(next); assert.equal(r.c.data.loadingModal, false); r.tick(2000);
    assert.equal(r.c.data.loadingModal, false); assert.equal(r.timers.size, 0);
  }
});

test('new sentence, mode or chapter receives its own one-second wait', () => {
  for (const change of [r => r.change({ index: 1 }), r => r.change({ mode: 'chapter' }), r => {
    r.c.properties.chapter.chapterId = 'c2'; r.change({});
  }]) {
    const r = setup(); r.change({ status: 'loading' }); r.tick(1000);
    change(r); assert.equal(r.c.data.loadingModal, false);
    r.tick(999); assert.equal(r.c.data.loadingModal, false);
    r.tick(1); assert.equal(r.c.data.loadingModal, true);
  }
});

test('rapid cancellation and retry ignore stale callbacks even for the same sentence', () => {
  const r = setup(); r.change({ status: 'loading' });
  const stale = [...r.timers.values()][0].fn; r.tick(500);
  r.change({ status: 'paused' }); r.change({ status: 'loading' });
  stale(); assert.equal(r.c.data.loadingModal, false);
  r.tick(999); assert.equal(r.c.data.loadingModal, false);
  r.tick(1); assert.equal(r.c.data.loadingModal, true);
});

test('hide and detach clear waits; hidden updates and old callbacks cannot reopen the modal', () => {
  const r = setup(); r.change({ status: 'loading' });
  const old = [...r.timers.values()][0].fn; r.tick(1000); r.hide();
  assert.equal(r.c.data.loadingModal, false); r.change({ currentTime: 2 }); old(); r.tick(2000);
  assert.equal(r.c.data.loadingModal, false); assert.equal(r.timers.size, 0);
  r.change({ status: 'paused' }); r.show(); r.tick(2000); assert.equal(r.c.data.loadingModal, false);
  r.change({ status: 'loading' }); const stale = [...r.timers.values()][0].fn;
  r.detach(); const writes = r.writes; stale(); r.tick(2000);
  assert.equal(r.timers.size, 0); assert.equal(r.writes, writes);
});
