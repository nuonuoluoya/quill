const { reference, validReference, favoriteId, validateItem, row } = require('../utils/favorites');
const { playable } = require('../utils/contracts');
const error = (code, message) => Object.assign(new Error(message), { code });
const enc = encodeURIComponent;
const LIMIT = 10000;
const inaccessible = code => ['BOOK_FORBIDDEN','BOOK_NOT_FOUND','BUILD_REVOKED','BUILD_RETIRED','BUILD_NOT_FOUND','CHAPTER_NOT_FOUND','SENTENCE_NOT_FOUND','NOT_FOUND'].includes(code);
class Favorites {
  constructor(ports) { this.p = ports; this.reset(); }
  reset() { this.owner = null; this.version = -1; this.states = new Map(); this.pending = new Map(); this.revision = (this.revision || 0) + 1; }
  capture() {
    const scope = this.p.scope();
    if (this.owner !== scope.key) { this.reset(); this.owner = scope.key; }
    return scope;
  }
  guard(scope) { if (this.p.scope().key !== scope.key || this.owner !== scope.key) throw error('STALE_IDENTITY', '账号已切换，请重新读取收藏'); }
  changed() { this.revision++; this.p.changed?.(); }
  confirmed(state) { this.states.set(state.favoriteId,state); const pending = this.pending.get(state.favoriteId); if (pending && !pending.flight) this.pending.delete(state.favoriteId); }
  acceptVersion(version) {
    if (!Number.isSafeInteger(version) || version < 0) throw error('CONTENT_INVALID', '收藏版本格式不一致');
    if (version < this.version) throw error('FAVORITES_CHANGED', '收藏已变化，请重新读取');
    if (version > this.version) { this.states.clear(); this.version = version; }
  }
  guestData() {
    const value = this.p.storage.get(this.p.guestKey);
    if (value === undefined || value === null || value === '') return { schema: 1, version: 0, items: [] };
    if (value.schema !== 1 || !Number.isSafeInteger(value.version) || value.version < 0 || !Array.isArray(value.items) || value.items.length > LIMIT)
      throw error('FAVORITES_STORAGE_INVALID', '本机收藏数据无法读取，请保留数据并重试');
    const ids = new Set();
    for (const item of value.items) {
      if (!validReference(item.reference) || item.favoriteId !== favoriteId(item.reference) || ids.has(item.favoriteId) || !item.sourceBuildId ||
        !Number.isFinite(Date.parse(item.favoritedAt)) || !Number.isSafeInteger(item.addedVersion) || item.addedVersion <= 0 || item.addedVersion > value.version)
        throw error('FAVORITES_STORAGE_INVALID', '本机收藏数据无法读取，请保留数据并重试');
      ids.add(item.favoriteId);
    }
    return value;
  }
  async guestItem(record, scope, cache = new Map()) {
    const ref = record.reference;
    const memo = (key, load) => { if (!cache.has(key)) cache.set(key, Promise.resolve().then(load)); return cache.get(key); };
    const unavailable = status => ({ favoriteId: record.favoriteId, favoritedAt: record.favoritedAt, status, reference: null, resolvedBuildId: null, sentence: null, source: null, playable: false });
    try {
      const book = await memo('b:' + ref.bookId, () => this.p.content.book(ref.bookId)); this.guard(scope);
      if (book.visibility !== 'sample-public') return unavailable('forbidden');
      if (book.textRevision !== ref.textRevision) return unavailable('text_revision_changed');
      const summary = book.chapters.find(c => c.id === ref.chapterId);
      if (!summary) return unavailable('content_unavailable');
      const chapter = await memo(JSON.stringify([book.bookId,book.buildId,ref.chapterId]), () => this.p.content.chapter(book, ref.chapterId)); this.guard(scope);
      const sentence = chapter.sentences.find(s => s.id === ref.sentenceId);
      if (!sentence) return unavailable('content_unavailable');
      const season = book.seasons?.find(s => s.id === summary.seasonId), episode = book.episodes?.find(e => e.id === summary.episodeId);
      return { favoriteId: record.favoriteId, favoritedAt: record.favoritedAt, status: 'available', reference: ref, resolvedBuildId: book.buildId, sentence,
        source: { bookTitle: book.title, chapterTitle: summary.title, contentType: book.contentType || 'book', seasonTitle: season?.title || null,
          episodeTitle: episode?.title || null, episodeNumber: episode?.number || summary.episodeNumber || null, part: summary.part || null }, playable: playable(sentence) };
    } catch (e) {
      this.guard(scope);
      if (inaccessible(e.code)) return unavailable(e.code === 'BOOK_FORBIDDEN' ? 'forbidden' : 'content_unavailable');
      throw e; // A transport failure is not a permanent invalid favorite.
    }
  }
  async list({ query = '', cursor = null } = {}) {
    const scope = this.capture(), q = query.trim().slice(0,100);
    let result;
    if (!scope.guest) {
      result = await this.p.api('/me/favorites?limit=20&q=' + enc(q) + (cursor ? '&cursor=' + enc(cursor) : ''));
      this.guard(scope);
    } else {
      const data = this.guestData(); let offset = 0;
      if (cursor) {
        let parsed; try { parsed = JSON.parse(cursor); } catch (_) { throw error('INVALID_REQUEST', '收藏分页已失效，请重新读取'); }
        if (parsed.version !== data.version) throw error('FAVORITES_CHANGED', '收藏已变化，请重新读取');
        if (parsed.q !== q || !Number.isInteger(parsed.offset) || parsed.offset < 0) throw error('INVALID_REQUEST', '收藏分页已失效，请重新读取');
        offset = parsed.offset;
      }
      const sorted = data.items.slice().sort((a,b) => b.addedVersion - a.addedVersion), resolved = new Array(sorted.length), cache = new Map();
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, sorted.length) }, async () => {
        while (next < sorted.length) { const i = next++; resolved[i] = await this.guestItem(sorted[i], scope, cache); }
      }));
      this.guard(scope);
      // Detect a local write while the public references were being resolved.
      if (this.guestData().version !== data.version) throw error('FAVORITES_CHANGED', '收藏已变化，请重新读取');
      const matches = resolved.filter(item => !q || (item.status === 'available' && item.sentence.text.toLowerCase().includes(q.toLowerCase())));
      result = { items: matches.slice(offset,offset+20), nextCursor: offset+20 < matches.length ? JSON.stringify({ version:data.version,q,offset:offset+20 }) : null,
        version: data.version, totalCount: sorted.length, matchedCount: matches.length, playableCount: matches.filter(i => i.playable).length };
    }
    if (!Array.isArray(result.items) || !(result.nextCursor === null || typeof result.nextCursor === 'string') ||
      !['totalCount','matchedCount','playableCount'].every(k => Number.isSafeInteger(result[k]) && result[k] >= 0) ||
      result.playableCount > result.matchedCount || result.matchedCount > result.totalCount) throw error('CONTENT_INVALID', '收藏列表格式不一致');
    this.acceptVersion(result.version);
    const items = result.items.map(row);
    items.forEach(i => this.confirmed({ favoriteId:i.id,saved:true }));
    return { ...result, items, total: q ? result.matchedCount : result.totalCount };
  }
  async get(id) {
    const scope = this.capture(); let item;
    if (scope.guest) {
      const record = this.guestData().items.find(i => i.favoriteId === id);
      if (!record) throw error('FAVORITE_NOT_FOUND', '收藏已取消，请重新读取');
      item = await this.guestItem(record, scope);
    } else item = await this.p.api('/me/favorites/' + enc(id));
    this.guard(scope); return validateItem(item);
  }
  async resolve(item) {
    const scope = this.capture(), value = await this.get(item.favoriteId || item.id); this.guard(scope);
    if (value.status !== 'available') throw Object.assign(error('FAVORITE_UNAVAILABLE', row(value).unavailableLabel), { favoriteItem: row(value) });
    const ref = value.reference;
    const book = await this.p.content.snapshot({ bookId:ref.bookId,buildId:value.resolvedBuildId }); this.guard(scope);
    if (book.textRevision !== ref.textRevision || (scope.guest && book.visibility !== 'sample-public')) throw error('BOOK_FORBIDDEN','收藏内容已变化，请重新读取');
    const chapter = await this.p.content.chapter(book, ref.chapterId); this.guard(scope);
    const sentence = chapter.sentences.find(s => s.id === ref.sentenceId);
    if (!sentence) throw error('SENTENCE_NOT_FOUND','原句子已不可用');
    return { book, chapter, sentence };
  }
  async status(book, chapter, ids = chapter.sentences.map(s => s.id)) {
    const scope = this.capture(); if (!ids.length) return [];
    if (scope.guest) {
      const current = await this.p.content.book(book.bookId); this.guard(scope);
      if (current.visibility !== 'sample-public' || current.textRevision !== book.textRevision) throw error('BOOK_FORBIDDEN','公开内容已变化，请刷新后收藏');
      const data = this.guestData(); this.acceptVersion(data.version);
      const saved = new Set(data.items.map(i => i.favoriteId));
      return ids.map(sentenceId => { const id = favoriteId({ bookId:book.bookId,textRevision:book.textRevision,chapterId:chapter.chapterId,sentenceId }); const state = {sentenceId,favoriteId:id,saved:saved.has(id)}; this.states.set(id,state); return state; });
    }
    const states = []; let version;
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i,i+200);
      const result = await this.p.api('/me/favorites/status','POST',{ bookId:book.bookId,textRevision:book.textRevision,sourceBuildId:book.buildId,chapterId:chapter.chapterId,sentenceIds:batch }); this.guard(scope);
      if (!Array.isArray(result.states) || result.states.length !== batch.length || new Set(result.states.map(s=>s.sentenceId)).size !== batch.length || result.states.some(s=>!batch.includes(s.sentenceId) || typeof s.saved !== 'boolean' || s.favoriteId !== favoriteId({bookId:book.bookId,textRevision:book.textRevision,chapterId:chapter.chapterId,sentenceId:s.sentenceId}))) throw error('CONTENT_INVALID','收藏状态格式不一致');
      if (version !== undefined && version !== result.version) throw error('FAVORITES_CHANGED','收藏已变化，请重试读取');
      version = result.version; states.push(...result.states);
    }
    this.acceptVersion(version); states.forEach(s=>this.confirmed(s)); return states;
  }
  async set(book, chapter, sentence, saved) {
    const ref = reference(book,chapter,sentence);
    return this.write(favoriteId(ref), saved, { ...ref,sourceBuildId:book.buildId });
  }
  async remove(item) { return this.write(item.favoriteId || item.id, false); }
  async write(id, saved, source) {
    const scope = this.capture();
    if (scope.guest) {
      if (saved) {
        const sample = await this.p.content.snapshot({bookId:source.bookId,buildId:source.sourceBuildId}); this.guard(scope);
        const active = await this.p.content.book(source.bookId); this.guard(scope);
        if (sample.visibility !== 'sample-public' || active.visibility !== 'sample-public') throw error('BOOK_FORBIDDEN','游客只能收藏公开体验内容');
        if (sample.textRevision !== source.textRevision || active.textRevision !== source.textRevision) throw error('FAVORITE_TEXT_REVISION_CHANGED','原文版本已更新，请重新读取');
        const chapter = await this.p.content.chapter(sample,source.chapterId); this.guard(scope);
        if (!chapter.sentences.some(s=>s.id===source.sentenceId)) throw error('FAVORITE_INVALID','收藏句子不存在');
      }
      const before = this.guestData(), existing = before.items.find(i=>i.favoriteId===id);
      if (saved && !existing && before.items.length >= LIMIT) throw error('FAVORITES_LIMIT_REACHED','收藏已达10000条，请先取消部分收藏');
      let data = before;
      if (saved !== !!existing) {
        const version = before.version + 1, items = before.items.filter(i=>i.favoriteId!==id);
        if (saved) items.push({ favoriteId:id, reference:{bookId:source.bookId,textRevision:source.textRevision,chapterId:source.chapterId,sentenceId:source.sentenceId},sourceBuildId:source.sourceBuildId,favoritedAt:new Date(this.p.now()).toISOString(),addedVersion:version });
        data = { schema:1,version,items }; this.guard(scope); this.p.storage.set(this.p.guestKey,data);
      }
      this.acceptVersion(data.version); const result={favoriteId:id,saved,version:data.version,favoritedAt:data.items.find(i=>i.favoriteId===id)?.favoritedAt || null}; this.states.set(id,result); this.changed(); return result;
    }
    let pending = this.pending.get(id);
    if (pending?.flight) return pending.flight;
    if (pending && pending.saved !== saved) throw error('FAVORITE_PENDING','上一操作尚未确认，请先重新读取收藏');
    if (!pending) {
      pending = { saved, method:saved?'PUT':'DELETE', path:saved?'/me/favorites':'/me/favorites/'+enc(id),
        body:{ ...(saved?source:{}),clientMutationId:this.p.uuid(),clientMutationCreatedAt:new Date(this.p.now()).toISOString() } };
      this.pending.set(id,pending);
    }
    const run = async () => {
      try {
        const result = await this.p.api(pending.path,pending.method,pending.body); this.guard(scope);
        if (result.favoriteId !== id || typeof result.saved !== 'boolean' || (result.saved ? !Number.isFinite(Date.parse(result.favoritedAt)) : result.favoritedAt !== null)) throw error('CONTENT_INVALID','收藏保存回执格式不一致，请重试');
        this.pending.delete(id); this.acceptVersion(result.version); this.states.set(id,result); this.changed(); return result;
      } catch (e) {
        this.guard(scope);
        if (e.code === 'FAVORITE_MUTATION_EXPIRED') {
          try { await this.get(id); this.guard(scope); this.states.set(id,{favoriteId:id,saved:true}); }
          catch (lookup) { this.guard(scope); if (lookup.code !== 'FAVORITE_NOT_FOUND') throw lookup; this.states.set(id,{favoriteId:id,saved:false}); }
          this.pending.delete(id); this.changed(); throw error('FAVORITE_MUTATION_EXPIRED','上次操作已过期，已重新读取状态，请再次点击');
        }
        if (e.status >= 400 && e.status < 500 && e.status !== 429) this.pending.delete(id);
        throw e;
      } finally { pending.flight = null; }
    };
    pending.flight = run(); return pending.flight;
  }
}
module.exports = { Favorites };
