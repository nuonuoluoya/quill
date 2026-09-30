function podcast() {
  const missingLesson = new Set([32, 43, 58, 337]), missingDialogue = new Set([96, 158, 164, 288]);
  const episodes = Array.from({ length: 365 }, (_, i) => ({ id: 'ep' + String(i + 1).padStart(3, '0'), number: i + 1, title: i === 336 ? 'Finding Your Way Around a New City' : 'Practice Topic ' + (i + 1) }));
  return { bookId: 'podcast-fixture', buildId: 'v1', textRevision: 'r1', title: 'Practice Podcast', language: 'en',
    visibility: 'private', contentScope: 'sample', contentType: 'podcast', episodeCount: 365, unitCount: 722, chapterCount: 722,
    chapterAudioAvailableCount: 0, contentChapterCount: 722, seasons: [], episodes,
    chapters: episodes.flatMap(e => ['dialogue', 'lesson'].filter(part => !(part === 'dialogue' ? missingDialogue : missingLesson).has(e.number))
      .map(part => ({ id: e.id + (part === 'dialogue' ? '-dg' : '-pb'), episodeId: e.id, part, title: e.title + ' ' + part, sentenceCount: 2, playableCount: 1 }))) };
}
function chapter(book, id) {
  const part = book.chapters.find(c => c.id === id);
  return { bookId: book.bookId, buildId: book.buildId, textRevision: book.textRevision, chapterId: id,
    episodeId: part.episodeId, part: part.part,
    chapterAudio: { status: 'unavailable', audioId: null, duration: null, reasons: ['No whole-part audio'] },
    sentences: [
      { id: id + '-s1', index: 1, text: 'A practice sentence.', audioId: id + '-a1', duration: 2, alignment: { status: 'verified', reasons: [] } },
      { id: id + '-s2', index: 2, text: 'A sentence awaiting review.', audioId: null, duration: null, alignment: { status: 'needs_review', reasons: ['Review required'] } }
    ] };
}
module.exports = { podcast, chapter };
