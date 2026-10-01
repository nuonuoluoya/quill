// Public preview and private book are separate server-side access boundaries.
const PREVIEW_BOOK_ID = 'hp1-chapter1-preview';
const FULL_BOOK_ID = 'hp1-en';
function isPreview(book) { return book && book.bookId === PREVIEW_BOOK_ID; }
function lockedChapterLogin(book, id) {
  return isPreview(book) && (book.lockedChapters || []).some(c => c.id === id)
    ? '/pages/settings/settings?returnBookId=' + FULL_BOOK_ID + '&returnChapterId=' + encodeURIComponent(id) : '';
}
function validPreview(book) {
  if (!isPreview(book)) return true;
  if (book.visibility !== 'sample-public' || book.contentScope !== 'sample' ||
      book.previewOfBookId !== FULL_BOOK_ID || book.chapters.length !== 1 ||
      !Array.isArray(book.lockedChapters) || book.lockedChapters.length !== 16) return false;
  const ids = new Set(book.chapters.map(c => c.id));
  return book.lockedChapters.every((c, index) => {
    if (!c || typeof c.id !== 'string' || !c.id || ids.has(c.id) ||
        typeof c.title !== 'string' || !c.title.trim() || c.number !== index + 2) return false;
    ids.add(c.id); return true;
  });
}
module.exports = { PREVIEW_BOOK_ID, FULL_BOOK_ID, isPreview, validPreview, lockedChapterLogin };
