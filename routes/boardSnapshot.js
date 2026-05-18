'use strict';

const express = require('express');
const { supabase } = require('../lib/supabase');

const router = express.Router();

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLean(value) {
  const lean = String(value || '').trim().toLowerCase();
  return ['over', 'under'].includes(lean) ? lean : null;
}

function snapshotRowFromCard(slateDate, card) {
  const playerId = toNumberOrNull(card.player_id ?? card.playerId ?? card.player?.id ?? card.players?.id);
  const propType = String(card.prop_type ?? card.propType ?? '').trim().toLowerCase();
  if (!playerId || !propType) return null;

  return {
    slate_date: slateDate,
    player_id: playerId,
    prop_type: propType,
    line: toNumberOrNull(card.line),
    lean: normalizeLean(card.lean ?? card.recommendation),
    market: card.market ?? card.market_label ?? card.marketLabel ?? propType,
    score_tier: card.score_tier ?? card.scoreTier ?? card.tier ?? null,
    book_line: toNumberOrNull(card.book_line ?? card.bookLine ?? card.line),
    locked_at: card.locked_at ?? card.lockedAt ?? new Date().toISOString(),
  };
}

router.post('/', async (req, res) => {
  try {
    if (!supabase) return res.status(502).json({ error: 'Supabase is not configured' });

    const { slateDate, cards } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(slateDate || ''))) {
      return res.status(400).json({ error: 'slateDate must be YYYY-MM-DD' });
    }
    if (!Array.isArray(cards)) {
      return res.status(400).json({ error: 'cards must be an array' });
    }

    const rows = cards
      .map(card => snapshotRowFromCard(slateDate, card || {}))
      .filter(Boolean);

    if (!rows.length) {
      return res.json({ ok: true, slateDate, count: 0 });
    }

    const { data, error } = await supabase
      .from('board_card_snapshots')
      .upsert(rows, { onConflict: 'slate_date,player_id,prop_type,source', ignoreDuplicates: true })
      .select('id');

    if (error) throw error;
    res.json({ ok: true, slateDate, count: data?.length ?? rows.length });
  } catch (error) {
    console.error('[board-snapshot]', error.message);
    res.status(502).json({ error: error.message });
  }
});

module.exports = router;
