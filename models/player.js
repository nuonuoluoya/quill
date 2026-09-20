"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.player = exports.playerState = void 0;
const events_1 = require("../utils/events");
const player_1 = require("../core/player");
const content_1 = require("./content");
const auth_1 = require("./auth");
const { sentenceAudio } = require('../utils/sentence-audio');
exports.playerState = (0, events_1.observable)((0, player_1.initialPlayer)());
exports.player = new player_1.Player(exports.playerState, ({ mode }) => {
    const audio = wx.createInnerAudioContext();
    audio.autoplay = false;
    audio.obeyMuteSwitch = true;
    return mode === 'sentence' ? sentenceAudio(wx, audio) : audio;
}, content_1.content.playback);
(0, auth_1.onIdentityChange)(() => exports.player.dispose());
