/**
 * Closing-line value style read from stored market_notes (opening vs line at publish).
 * movement = current_line - opening_line (same convention as calc-confidence).
 */

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function softAltFromMarketNotes(val) {
  if (!val || typeof val !== 'object') return null;
  const book = val.book != null ? String(val.book) : '';
  const line = toNum(val.line);
  if (!book || line == null) return null;
  return { book, line };
}

/**
 * @returns {null | { opening: number|null, current: number|null, movement: number|null, favor: 'help'|'hurt'|'flat', line: string|null, book_gap: number|null, line_sportsbook: string|null, other_books: Array<{ book: string, line: number }>|null, soft_over_alt: { book: string, line: number }|null, soft_under_alt: { book: string, line: number }|null }}
 */
function clvFromMarketNotes(pick) {
  const mn = pick?.market_notes;
  if (!mn || typeof mn !== 'object') return null;

  const soft_over_alt = softAltFromMarketNotes(mn.soft_over_alt);
  const soft_under_alt = softAltFromMarketNotes(mn.soft_under_alt);

  const opening = toNum(mn.opening_line);
  const current = toNum(mn.current_line);
  const movement = toNum(mn.movement) != null
    ? toNum(mn.movement)
    : (opening != null && current != null ? current - opening : null);

  if (movement == null && opening == null && current == null && !soft_over_alt && !soft_under_alt) return null;

  const rec = String(pick.recommendation || '').toUpperCase();
  if (!['OVER', 'UNDER'].includes(rec)) return null;

  let favor = 'flat';
  if (movement != null && Math.abs(movement) > 0.009) {
    if (rec === 'OVER') {
      if (movement < 0) favor = 'help';
      else favor = 'hurt';
    } else {
      if (movement > 0) favor = 'help';
      else favor = 'hurt';
    }
  }

  const line =
    opening != null && current != null
      ? `${opening}→${current}`
      : null;

  const otherBooks = Array.isArray(mn.other_books) && mn.other_books.length
    ? mn.other_books
      .map(ob => ({
        book: ob?.book != null ? String(ob.book) : '',
        line: toNum(ob?.line),
      }))
      .filter(ob => ob.book && ob.line != null)
    : null;

  return {
    opening,
    current,
    movement,
    favor,
    line,
    book_gap: toNum(mn.book_gap),
    line_sportsbook: mn.line_sportsbook != null ? String(mn.line_sportsbook) : null,
    other_books: otherBooks?.length ? otherBooks : null,
    soft_over_alt,
    soft_under_alt,
  };
}

module.exports = { clvFromMarketNotes, toNum, softAltFromMarketNotes };
