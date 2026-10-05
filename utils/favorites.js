const { sha256 } = require('./sha256');
const { playable } = require('./contracts');
const fields = ['bookId', 'textRevision', 'chapterId', 'sentenceId'];
const reference = (book, chapter, sentence) => ({ bookId: book.bookId, textRevision: book.textRevision, chapterId: chapter.chapterId, sentenceId: sentence.id });
const validReference = r => r && fields.every(k => typeof r[k] === 'string' && r[k].length > 0);
const favoriteId = r => sha256(JSON.stringify(fields.map(k => r[k])));
const unavailable = { forbidden: '内容访问权限已失效', text_revision_changed: '原文版本已更新', content_unavailable: '内容暂不可用' };
function validateItem(item) {
  if (!item || !/^[a-f0-9]{64}$/.test(item.favoriteId) || !Number.isFinite(Date.parse(item.favoritedAt)) || typeof item.playable !== 'boolean') throw Error('收藏数据格式不一致，请重新读取');
  if (item.status === 'available') {
    if (!validReference(item.reference) || favoriteId(item.reference) !== item.favoriteId || !item.resolvedBuildId || item.sentence?.id !== item.reference.sentenceId ||
      typeof item.sentence.text !== 'string' || !item.source || typeof item.source.bookTitle !== 'string' || typeof item.source.chapterTitle !== 'string' || item.playable !== playable(item.sentence)) throw Error('收藏内容格式不一致，请重新读取');
  } else if (!unavailable[item.status] || item.reference !== null || item.resolvedBuildId !== null || item.sentence !== null || item.source !== null || item.playable) throw Error('收藏权限数据格式不一致，请重新读取');
  return item;
}
function sourceLabel(s) {
  if (!s) return '';
  if (s.contentType === 'podcast') return [s.bookTitle, s.episodeNumber ? '第 ' + s.episodeNumber + ' 期' : s.episodeTitle || s.chapterTitle, s.part === 'dialogue' ? '对话' : s.part === 'lesson' ? '教学' : ''].filter(Boolean).join(' · ');
  if (s.contentType === 'tv') return [s.bookTitle, s.seasonTitle, s.episodeNumber ? '第 ' + s.episodeNumber + ' 集' : s.chapterTitle].filter(Boolean).join(' · ');
  return [s.bookTitle, s.chapterTitle].filter(Boolean).join(' · ');
}
function row(item) {
  validateItem(item);
  return { id: item.favoriteId, favoriteId: item.favoriteId, ...(item.reference || {}), favoritedAt: item.favoritedAt, status: item.status, saved: true,
    available: item.playable, locatable: item.status === 'available', text: item.sentence?.text || '', source: sourceLabel(item.source),
    unavailableLabel: unavailable[item.status] || '暂无逐句音频' };
}
module.exports = { reference, validReference, favoriteId, validateItem, row };
