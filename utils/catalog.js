// Display navigation only: preserve the backend's stable chapter and sentence IDs.
function episodeNumber(chapter, index) {
  return Number.isInteger(chapter.episodeNumber) && chapter.episodeNumber > 0 ? chapter.episodeNumber : index + 1;
}
function unitTitle(book, chapterId) {
  const index = book.chapters.findIndex(c => c.id === chapterId);
  if (index < 0) return '已保存位置';
  if (book.contentType !== 'tv') return 'Chapter ' + (index + 1);
  const chapter = book.chapters[index];
  const season = (book.seasons || []).find(s => s.id === chapter.seasonId);
  return (season ? season.title + ' · ' : '') + '第 ' + episodeNumber(chapter, index) + ' 集';
}
function catalog(book, selectedSeasonId, chapterId) {
  const isTv = book.contentType === 'tv';
  const all = book.chapters.map((c, index) => ({ ...c, number: String(isTv ? episodeNumber(c, index) : index + 1).padStart(2, '0') }));
  const seasons = isTv ? (book.seasons || []).slice().sort((a, b) => a.order - b.order).map(s => {
    const count = all.filter(c => c.seasonId === s.id).length;
    return { id: s.id, title: s.title, count, label: s.title + ' · ' + count + ' 集' };
  }) : [];
  const current = all.find(c => c.id === chapterId);
  const selected = seasons.find(s => s.id === selectedSeasonId) || seasons.find(s => current && s.id === current.seasonId) || seasons[0];
  const chapters = selected ? all.filter(c => c.seasonId === selected.id).sort((a, b) => a.episodeNumber - b.episodeNumber) : all;
  return {
    isTv, seasons, seasonIndex: selected ? seasons.indexOf(selected) : 0,
    selectedSeasonId: selected ? selected.id : '', selectedSeasonTitle: selected ? selected.title : '',
    chapters, unitLabel: isTv ? '集' : '章', catalogLabel: isTv ? '选集' : '章节',
    catalogSummary: (seasons.length ? seasons.length + ' 季 · ' : '') + all.length + (isTv ? ' 集' : ' 章')
  };
}
function seasonIdAt(seasons, value) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && seasons[index] ? seasons[index].id : null;
}
module.exports = { catalog, unitTitle, seasonIdAt };
