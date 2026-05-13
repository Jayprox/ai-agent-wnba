/**
 * Default sportsbook order — Caesars first (product default for posted lines).
 * When Caesars is missing for an event, we walk down the list.
 */

const SPORTSBOOK_PRIORITY = ['caesars', 'draftkings', 'fanduel', 'betmgm', 'bovada'];

function normalizeSportsbook(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * @param {Array<{ line: number, sportsbook?: string|null }>} entries
 * @returns {{ line: number, sportsbook: string } | null}
 */
function pickPreferredSportsbookLine(entries) {
  if (!entries?.length) return null;
  const valid = entries.filter(e => {
    const ln = Number(e.line);
    return Number.isFinite(ln) && e.sportsbook != null && String(e.sportsbook).length > 0;
  });
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => {
    const ia = SPORTSBOOK_PRIORITY.indexOf(normalizeSportsbook(a.sportsbook));
    const ib = SPORTSBOOK_PRIORITY.indexOf(normalizeSportsbook(b.sportsbook));
    const sa = ia === -1 ? 999 : ia;
    const sb = ib === -1 ? 999 : ib;
    if (sa !== sb) return sa - sb;
    return String(a.sportsbook || '').localeCompare(String(b.sportsbook || ''));
  });
  const first = sorted[0];
  return { line: Number(first.line), sportsbook: String(first.sportsbook) };
}

/** Short label for UI (matches server card chips). */
function sportsbookShortLabel(value) {
  const key = normalizeSportsbook(value);
  if (key === 'derived') return 'SZN';
  if (key === 'draftkings') return 'DK';
  if (key === 'fanduel') return 'FD';
  if (key === 'betmgm') return 'MGM';
  if (key === 'caesars') return 'CZR';
  if (key === 'bovada') return 'BOV';
  return String(value || '').slice(0, 5).toUpperCase();
}

module.exports = {
  SPORTSBOOK_PRIORITY,
  normalizeSportsbook,
  pickPreferredSportsbookLine,
  sportsbookShortLabel,
};
