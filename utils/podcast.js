const PARTS = [{ value: 'dialogue', label: '对话' }, { value: 'lesson', label: '教学' }];
const PAGE_SIZE = 20;

function validPodcast(book) {
  if (!Array.isArray(book.episodes) || (book.seasons || []).length) return false;
  const ids = new Set(), numbers = new Set(), parts = new Set(), populated = new Set();
  for (const episode of book.episodes) {
    if (!episode || typeof episode.id !== 'string' || !episode.id || ids.has(episode.id) ||
        !Number.isInteger(episode.number) || episode.number <= 0 || numbers.has(episode.number) ||
        typeof episode.title !== 'string' || !episode.title.trim()) return false;
    ids.add(episode.id); numbers.add(episode.number);
  }
  for (const chapter of book.chapters) {
    const key = JSON.stringify([chapter.episodeId, chapter.part]);
    if (!ids.has(chapter.episodeId) || !PARTS.some(p => p.value === chapter.part) || parts.has(key) ||
        chapter.seasonId != null || chapter.episodeNumber != null) return false;
    parts.add(key); populated.add(chapter.episodeId);
  }
  return populated.size === ids.size && (book.episodeCount === undefined || book.episodeCount === ids.size);
}

function episodeFor(book, chapterId) {
  const chapter = (book.chapters || []).find(c => c.id === chapterId);
  return chapter && (book.episodes || []).find(e => e.id === chapter.episodeId);
}

function podcastEpisodes(book) {
  const byEpisode = new Map();
  for (const chapter of book.chapters || []) {
    if (!byEpisode.has(chapter.episodeId)) byEpisode.set(chapter.episodeId, new Map());
    byEpisode.get(chapter.episodeId).set(chapter.part, chapter);
  }
  return (book.episodes || []).slice().sort((a, b) => a.number - b.number).map(episode => ({
    ...episode,
    parts: PARTS.map(part => {
      const chapter = byEpisode.get(episode.id)?.get(part.value);
      return { key: part.value, label: part.label, chapterId: chapter ? chapter.id : '',
        available: !!chapter, sentenceCount: chapter ? chapter.sentenceCount : 0,
        playableCount: chapter ? chapter.playableCount : 0 };
    })
  }));
}

function findEpisodes(episodes, query) {
  const search = String(query || '').trim().toLowerCase();
  if (!search) return episodes;
  const number = search.match(/^(?:ep\s*)?0*(\d+)$|^第\s*0*(\d+)\s*期$/i);
  if (number) return episodes.filter(e => e.number === Number(number[1] || number[2]));
  return episodes.filter(e => e.title.toLowerCase().includes(search));
}

module.exports = { PARTS, PAGE_SIZE, validPodcast, episodeFor, podcastEpisodes, findEpisodes };
