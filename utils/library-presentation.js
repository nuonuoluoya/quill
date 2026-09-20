// Presentation-only extensions to the existing /books contract.
// Missing contentType is a legacy book; an unknown explicit type is not a book.
const TYPES = [
  { value: 'all', label: '全部' },
  { value: 'book', label: '书籍', unit: '章' },
  { value: 'blog', label: '博客', unit: '篇', art: 'blog' },
  { value: 'movie', label: '电影', unit: '段', art: 'movie' },
  { value: 'tv', label: '电视剧', unit: '集', art: 'tv' }
];
function typeOf(item) {
  const value = item.contentType || 'book';
  return TYPES.find(t => t.value === value && t.value !== 'all') || { value: 'unknown', label: '其他内容', unit: '节' };
}
function present(item) {
  const type = typeOf(item);
  const words = String(item.title || '').split(/\s+/).filter(w => w && !/^(the|a|an|and|of|from|in|on)$/i.test(w));
  const count = Number.isInteger(item.unitCount) ? item.unitCount : item.chapterCount;
  const language = /^en(?:[-_]|$)/i.test(item.language || '') ? '英文' : item.language;
  const available = item.chapterAudioAvailableCount || 0;
  const complete = available > 0 && available === item.contentChapterCount;
  // Never promote sample access to complete content or invent audio availability.
  const audioLabel = complete ? '全文音频可用' : available > 0 ? '部分全文音频可用' : '全文音频暂不可用';
  const coverUrl = typeof item.coverUrl === 'string' && /^(https:\/\/|\/imgs\/)/.test(item.coverUrl) ? item.coverUrl : '';
  return { ...item, contentType: type.value, typeLabel: type.label, coverArt: type.art || '', coverUrl,
    coverInitials: words.slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'PV',
    coverTitle: String(item.title || '').length <= 28 && String(item.title || '').trim().split(/\s+/).length <= 3 ? String(item.title || '').trim().replace(/\s+/g, '\n') : words.slice(0, 2).map(w => w[0]).join('').toUpperCase(),
    audioLabel, audioComplete: complete,
    metadata: [language, type.label, Number.isInteger(count) && count >= 0 ? count + ' ' + type.unit : '', item.contentScope === 'sample' ? '样本' : ''].filter(Boolean).join(' · ')
  };
}
function visible(items, type) { return type === 'all' ? items : items.filter(b => b.contentType === type); }
function recentPosition(item, progress, position) {
  const type = typeOf(item);
  const index = (item.chapters || []).findIndex(c => c.id === progress.chapterId);
  if (index < 0) return type.label + ' · ' + position;
  const sentence = position.split(' · ').slice(1).join(' · ') || '已保存句子位置';
  return type.label + ' · 第 ' + (index + 1) + ' ' + type.unit + ' · ' + sentence;
}
module.exports = { TYPES, typeOf, present, visible, recentPosition };
