const { Shadowing, initialShadowing } = require('../core/shadowing');
const { recordingPorts, originalAudio, localAudio } = require('../utils/shadowing-runtime');
const { observable } = require('../utils/events');
const { player, playerState } = require('./player');
const { content } = require('./content');
const { onIdentityChange } = require('./auth');
const shadowState = observable(initialShadowing());
let preference;
const shadowing = new Shadowing(shadowState, {
    ...recordingPorts(wx), now: () => Date.now(),
    forgetPreferences() { preference = null; },
    pauseOrdinary() {
        preference = { book: player.book, loop: playerState.loop, continuous: playerState.continuous };
        player.pause(); player.setLoop(false); player.setContinuous(false);
    },
    lock(value) {
        player.suspended = value;
        if (!value && preference) {
            if (preference.book === player.book) { player.setLoop(preference.loop); player.setContinuous(preference.continuous); }
            preference = null;
        }
    },
    original: (target, speed, events) => originalAudio(wx, content.playback, target, speed, events),
    mine: (path, events) => localAudio(wx, path, events)
});
onIdentityChange(() => shadowing.reset());
module.exports = { shadowing, shadowState };
