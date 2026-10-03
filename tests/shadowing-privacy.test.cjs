const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
    let definition, listener, starts = 0, sounds = 0;
    const requests = [];
    const state = { open: true, reliable: true, status: 'ready' };
    const engine = {
        op: 0, foreground: true,
        resume() { this.foreground = true; },
        interrupt() { this.foreground = false; this.stopPlayback(); },
        stopPlayback() { this.op++; listener?.(); },
        close() { this.op++; state.open = false; listener?.(); },
        startRecording() { starts++; },
        play() { sounds++; },
        publish(value) { Object.assign(state, value); listener?.(); }
    };
    const api = {
        getPrivacySetting(options) { requests.push(options); },
        openSetting(options) { options.success(); }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../components/shadowing/shadowing.js'), 'utf8'), {
        wx: api, Component(value) { definition = value; },
        require(name) {
            if (name.endsWith('/shadowing')) return { shadowing: engine, shadowState: state };
            if (name.endsWith('/events')) return { subscribe(fn) { listener = fn; return () => { listener = null; }; } };
            if (name.endsWith('/contracts')) return { timeLabel: () => '00:00' };
            throw Error('Unexpected dependency');
        }
    });
    const c = { ...definition.methods, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
    definition.lifetimes.attached.call(c);
    return { c, state, engine, requests, get starts() { return starts; }, get sounds() { return sounds; },
        hide() { definition.pageLifetimes.hide.call(c); }, show() { definition.pageLifetimes.show.call(c); },
        detach() { definition.lifetimes.detached.call(c); } };
}

test('opening does not request privacy; active recording waits for explicit privacy agreement', () => {
    const r = setup(); assert.equal(r.requests.length, 0); assert.equal(r.starts, 0);
    r.c.record(); r.c.record(); assert.equal(r.requests.length, 1); assert.equal(r.engine.op, 1);
    r.c.original(); assert.equal(r.sounds, 0);
    r.requests[0].success({ needAuthorization: true });
    assert.equal(r.c.data.privacyNeeded, true); assert.equal(r.starts, 0);
    r.c.privacyAgreed(); assert.equal(r.starts, 1); r.c.privacyAgreed(); assert.equal(r.starts, 1);
});

test('already agreed privacy starts only for the active recording request', () => {
    const r = setup(); r.c.record(); r.requests[0].success({ needAuthorization: false });
    assert.equal(r.starts, 1); assert.equal(r.c.data.privacyChecking, false);
});

test('close, background and detach ignore late privacy results', () => {
    for (const finish of [r => r.c.close(), r => r.hide(), r => r.engine.interrupt(), r => r.detach()]) {
        const r = setup(); r.c.record(); finish(r);
        r.requests[0].success({ needAuthorization: false }); r.requests[0].fail();
        assert.equal(r.starts, 0); assert.equal(r.state.error, undefined);
    }
    const r = setup(); r.c.record(); r.hide(); r.show();
    assert.equal(r.c.data.privacyChecking, false);
    r.c.record(); r.requests[0].success({ needAuthorization: true }); r.requests[0].fail();
    assert.equal(r.c.data.privacyChecking, true); assert.equal(r.c.data.privacyNeeded, false);
    r.requests[1].success({ needAuthorization: false }); assert.equal(r.starts, 1);
});

test('late agreement cannot start after close or interruption, and settings never start recording', () => {
    for (const finish of [r => r.c.close(), r => r.hide(), r => r.engine.interrupt()]) {
        const r = setup(); r.c.record(); r.requests[0].success({ needAuthorization: true });
        finish(r); r.c.privacyAgreed(); assert.equal(r.starts, 0);
        r.c.settings(); assert.equal(r.starts, 0);
    }
});

test('privacy query failure allows explicit retry and never requests microphone', () => {
    const r = setup(); r.c.record(); r.requests[0].fail();
    assert.equal(r.c.data.privacyChecking, false); assert.ok(r.state.error); assert.equal(r.starts, 0);
    r.c.record(); assert.equal(r.requests.length, 2);
});

test('system interruption without page hide unlocks the next manual privacy attempt', () => {
    const r = setup(); r.c.record(); r.engine.interrupt();
    assert.equal(r.c.data.privacyChecking, false);
    r.c.record(); assert.equal(r.requests.length, 2);
    r.requests[0].success({ needAuthorization: false }); assert.equal(r.starts, 0);
    r.requests[1].success({ needAuthorization: false }); assert.equal(r.starts, 1);
});
