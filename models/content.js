"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.content = exports.bookPath = void 0;
exports.checkBook = checkBook;
exports.checkChapter = checkChapter;
const auth_1 = require("./auth");
const http_1 = require("../utils/http");
const { validPodcast } = require('../utils/podcast');
const { validPreview } = require('../utils/guest-preview');
const { playable: isPlayable } = require('../utils/contracts');
const enc = encodeURIComponent, chapterCache = new Map();
async function read(path) {
    try {
        return await (0, auth_1.api)(path);
    }
    catch (e) {
        if (!(e instanceof http_1.ApiError) ||
            (e.status !== 0 && e.status < 500) ||
            e.code === 'STALE_IDENTITY')
            throw e;
        await new Promise((r) => setTimeout(r, 1000));
        return (0, auth_1.api)(path);
    }
}
const bookPath = (b) => `/books/${enc(b.bookId)}/builds/${enc(b.buildId)}`;
exports.bookPath = bookPath;
function invalid() {
    throw new http_1.ApiError('CONTENT_INVALID', '内容格式不一致，请返回书架刷新');
}
function checkBook(b) {
    if (!b ||
        !b.bookId ||
        !b.buildId ||
        !b.textRevision ||
        !Array.isArray(b.chapters) ||
        !['sample', 'complete'].includes(b.contentScope))
        invalid();
    const ids = new Set();
    for (const c of b.chapters) {
        if (ids.has(c.id) ||
            !c.id ||
            !Number.isInteger(c.sentenceCount) ||
            c.sentenceCount < 0 ||
            c.playableCount > c.sentenceCount)
            invalid();
        ids.add(c.id);
    }
    if (b.contentType === 'podcast' && !validPodcast(b)) invalid();
    if (!validPreview(b)) invalid();
    return b;
}
function checkChapter(c, b) {
    const e = b.chapters.find((e) => e.id === (c === null || c === void 0 ? void 0 : c.chapterId));
    if (!e ||
        c.bookId !== b.bookId ||
        c.buildId !== b.buildId ||
        c.textRevision !== b.textRevision ||
        !Array.isArray(c.sentences) ||
        c.sentences.length !== e.sentenceCount)
        invalid();
    if (b.contentType === 'podcast' && (c.episodeId !== e.episodeId || c.part !== e.part)) invalid();
    const a = c.chapterAudio;
    if (!a || !['available', 'unavailable'].includes(a.status) || !Array.isArray(a.reasons))
        invalid();
    if (a.status === 'available'
        ? !a.audioId || !(a.duration > 0)
        : a.audioId !== null || a.duration !== null || !a.reasons.length)
        invalid();
    let playable = 0;
    const ids = new Set();
    for (const [i, s] of c.sentences.entries()) {
        if (!s.id ||
            ids.has(s.id) ||
            s.index !== i + 1 ||
            typeof s.text !== 'string' ||
            !s.alignment ||
            !Array.isArray(s.alignment.reasons))
            invalid();
        ids.add(s.id);
        const can = isPlayable(s);
        if (['verified', 'auto_passed'].includes(s.alignment.status)) {
            if (!can)
                invalid();
        }
        else if (!['needs_review', 'unmatched', 'excluded'].includes(s.alignment.status) ||
            (!can && (s.audioId !== null || s.duration !== null)) ||
            !s.alignment.reasons.length)
            invalid();
        if (can) playable++;
    }
    if (playable !== e.playableCount)
        invalid();
    return c;
}
exports.content = {
    async list(audience, cursor, contentType) {
        const p = await read(`/books?audience=${audience}&limit=20${contentType ? `&contentType=${enc(contentType)}` : ''}${cursor ? `&cursor=${enc(cursor)}` : ''}`);
        if (!Array.isArray(p === null || p === void 0 ? void 0 : p.items) || !(p.nextCursor === null || typeof p.nextCursor === 'string'))
            invalid();
        return p;
    },
    async book(bookId) {
        return checkBook(await read(`/books/${enc(bookId)}`));
    },
    async snapshot(b) {
        return checkBook(await read((0, exports.bookPath)(b)));
    },
    async chapter(b, id) {
        const key = JSON.stringify([(0, auth_1.identity)(), b.bookId, b.buildId, id]);
        if (chapterCache.has(key))
            return chapterCache.get(key);
        const c = checkChapter(await read(`${(0, exports.bookPath)(b)}/chapters/${enc(id)}`), b);
        chapterCache.set(key, c);
        if (chapterCache.size > 3)
            chapterCache.delete(chapterCache.keys().next().value);
        return c;
    },
    async playback(b, id, mode) {
        return (0, auth_1.api)(`${(0, exports.bookPath)(b)}/${mode === 'sentence' ? 'sentences' : 'chapters'}/${enc(id)}/playback`, 'POST');
    },
    clear() {
        chapterCache.clear();
    },
};
(0, auth_1.onIdentityChange)(exports.content.clear);
