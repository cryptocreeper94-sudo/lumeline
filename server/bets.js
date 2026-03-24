/**
 * LumeLine — Bets API Router
 * My Bets / Betting Wallet
 * CRUD for user bets, sportsbook management, screenshot OCR, email parsing
 */

import { Router } from 'express';
import db from './db.js';

const router = Router();

// ═══ Book colors for UI ═══
const BOOK_COLORS = {
  'draftkings': '#53d337',
  'fanduel': '#1493ff',
  'betmgm': '#c4a952',
  'caesars': '#1b3a2d',
  'betrivers': '#0055a5',
  'pointsbet': '#e44332',
  'bovada': '#cc0000',
  'bet365': '#027b5b',
  'betus': '#1a1a2e',
  'pinnacle': '#c8102e',
  'circa': '#d4af37',
  'hard-rock': '#d4af37',
  'barstool': '#e4002b',
  'espn-bet': '#d00',
  'fanatics': '#003087',
};

// ═══════════════════════════════════════════
//  SPORTSBOOKS
// ═══════════════════════════════════════════

// GET /api/bets/sportsbooks — list user's connected books
router.get('/sportsbooks', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT sb.*, 
        (SELECT COUNT(*) FROM user_bets ub WHERE ub.sportsbook_id = sb.id AND ub.status = 'active') AS active_bets,
        (SELECT COALESCE(SUM(CASE WHEN ub.status = 'won' THEN ub.result_amount WHEN ub.status = 'lost' THEN -ub.stake ELSE 0 END), 0) FROM user_bets ub WHERE ub.sportsbook_id = sb.id) AS pnl
       FROM user_sportsbooks sb WHERE sb.user_id = $1 ORDER BY sb.created_at`,
      [req.user.id]
    );
    res.json({ sportsbooks: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sportsbooks', message: err.message });
  }
});

// POST /api/bets/sportsbooks — add or update a sportsbook
router.post('/sportsbooks', async (req, res) => {
  try {
    const { book_name, book_slug, balance } = req.body;
    if (!book_name || !book_slug) return res.status(400).json({ error: 'book_name and book_slug required' });

    const color = BOOK_COLORS[book_slug] || '#06b6d4';
    const { rows } = await db.query(
      `INSERT INTO user_sportsbooks (user_id, book_name, book_slug, balance, color)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, book_slug) DO UPDATE SET balance = $4, book_name = $2
       RETURNING *`,
      [req.user.id, book_name, book_slug, balance || 0, color]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save sportsbook', message: err.message });
  }
});

// DELETE /api/bets/sportsbooks/:id
router.delete('/sportsbooks/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM user_sportsbooks WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete sportsbook' });
  }
});

// ═══════════════════════════════════════════
//  BETS — CRUD
// ═══════════════════════════════════════════

// GET /api/bets — all user bets (with game data + legs)
router.get('/', async (req, res) => {
  try {
    const status = req.query.status || null;
    const baseQ = `SELECT ub.*, 
           sb.book_name, sb.book_slug, sb.color AS book_color,
           g.status AS game_status, g.home_score, g.away_score, g.start_time AS live_start_time,
           c.confidence AS ll_confidence, c.house_lean AS ll_house_lean, c.integrity AS ll_integrity
         FROM user_bets ub
         LEFT JOIN user_sportsbooks sb ON ub.sportsbook_id = sb.id
         LEFT JOIN games g ON ub.game_id = g.id
         LEFT JOIN LATERAL (SELECT * FROM consensus WHERE game_id = g.id ORDER BY generated_at DESC LIMIT 1) c ON TRUE
         WHERE ub.user_id = $1`;
    const q = status
      ? baseQ + ` AND ub.status = $2 ORDER BY ub.placed_at DESC`
      : baseQ + ` ORDER BY CASE ub.status WHEN 'active' THEN 0 ELSE 1 END, ub.placed_at DESC`;

    const params = status ? [req.user.id, status] : [req.user.id];
    const { rows } = await db.query(q, params);

    // Attach legs for multi-leg bets
    const multiLegIds = rows.filter(b => (b.leg_count || 1) > 1).map(b => b.id);
    let legsMap = {};
    if (multiLegIds.length) {
      const { rows: legs } = await db.query(
        `SELECT * FROM bet_legs WHERE bet_id = ANY($1) ORDER BY leg_number`, [multiLegIds]
      );
      legs.forEach(l => { (legsMap[l.bet_id] = legsMap[l.bet_id] || []).push(l); });
    }
    const bets = rows.map(b => ({ ...b, legs: legsMap[b.id] || [] }));

    res.json({ bets, count: bets.length });
  } catch (err) {
    console.error('GET /api/bets error:', err);
    res.status(500).json({ error: 'Failed to fetch bets', message: err.message });
  }
});

// POST /api/bets — create a new bet (straight, parlay, SGP, teaser, etc.)
router.post('/', async (req, res) => {
  try {
    const { sportsbook_id, game_id, bet_type, pick, odds, stake, sport, home_team, away_team, game_time, notes, source,
            parlay_type, legs, promo_type, promo_detail, teaser_points, live_bet, confirmation_id, score_at_bet } = req.body;
    if (!pick) return res.status(400).json({ error: 'pick is required' });

    // Calculate potential win from American odds
    let potential_win = null;
    if (odds && stake) {
      potential_win = odds > 0
        ? parseFloat(((stake * odds) / 100).toFixed(2))
        : parseFloat(((stake * 100) / Math.abs(odds)).toFixed(2));
    }

    const legCount = Array.isArray(legs) && legs.length > 0 ? legs.length : 1;

    const { rows } = await db.query(
      `INSERT INTO user_bets (user_id, sportsbook_id, game_id, bet_type, pick, odds, stake, potential_win,
         sport, home_team, away_team, game_time, notes, source, placed_at,
         parlay_type, leg_count, promo_type, promo_detail, teaser_points, live_bet, confirmation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [req.user.id, sportsbook_id||null, game_id||null, bet_type||'spread', pick, odds||null, stake||null, potential_win,
       sport||null, home_team||null, away_team||null, game_time||null, notes||null, source||'manual', new Date(),
       parlay_type||null, legCount, promo_type||null, promo_detail||null, teaser_points||null, live_bet||false, confirmation_id||null]
    );

    const bet = rows[0];

    // Insert parlay/SGP legs
    if (Array.isArray(legs) && legs.length > 0) {
      for (let i = 0; i < legs.length; i++) {
        const l = legs[i];
        await db.query(
          `INSERT INTO bet_legs (bet_id, leg_number, pick, odds, bet_type, prop_type, prop_line, game_id, home_team, away_team, sport, score_at_bet)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [bet.id, i+1, l.pick, l.odds||null, l.bet_type||'spread', l.prop_type||null, l.prop_line||null,
           l.game_id||null, l.home_team||null, l.away_team||null, l.sport||null, l.score_at_bet||score_at_bet||null]
        );
      }
      // Fetch inserted legs
      const { rows: insertedLegs } = await db.query('SELECT * FROM bet_legs WHERE bet_id = $1 ORDER BY leg_number', [bet.id]);
      bet.legs = insertedLegs;
    } else {
      bet.legs = [];
    }

    const label = parlay_type ? `${legCount}-leg ${parlay_type.toUpperCase()}` : pick;
    console.log(`📋 New bet: ${req.user.display_name} — ${label} ($${stake || '?'})${promo_type ? ' 🎁'+promo_type : ''}${live_bet ? ' 🔴LIVE' : ''}`);
    res.status(201).json(bet);
  } catch (err) {
    console.error('POST /api/bets error:', err);
    res.status(500).json({ error: 'Failed to create bet', message: err.message });
  }
});

// PUT /api/bets/:id — update bet (settle, edit)
router.put('/:id', async (req, res) => {
  try {
    const { status, result_amount, pick, odds, stake, notes } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (status) { updates.push(`status = $${idx++}`); values.push(status); }
    if (result_amount !== undefined) { updates.push(`result_amount = $${idx++}`); values.push(result_amount); }
    if (pick) { updates.push(`pick = $${idx++}`); values.push(pick); }
    if (odds !== undefined) { updates.push(`odds = $${idx++}`); values.push(odds); }
    if (stake !== undefined) { updates.push(`stake = $${idx++}`); values.push(stake); }
    if (notes !== undefined) { updates.push(`notes = $${idx++}`); values.push(notes); }

    if (status === 'won' || status === 'lost' || status === 'push') {
      updates.push(`settled_at = NOW()`);
    }

    // Recalculate potential win if odds/stake changed
    if ((odds !== undefined || stake !== undefined) && !updates.find(u => u.includes('potential_win'))) {
      const finalOdds = odds !== undefined ? odds : null;
      const finalStake = stake !== undefined ? stake : null;
      if (finalOdds && finalStake) {
        const pw = finalOdds > 0
          ? parseFloat(((finalStake * finalOdds) / 100).toFixed(2))
          : parseFloat(((finalStake * 100) / Math.abs(finalOdds)).toFixed(2));
        updates.push(`potential_win = $${idx++}`);
        values.push(pw);
      }
    }

    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

    values.push(req.params.id, req.user.id);
    const { rows } = await db.query(
      `UPDATE user_bets SET ${updates.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
      values
    );

    if (!rows.length) return res.status(404).json({ error: 'Bet not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update bet', message: err.message });
  }
});

// DELETE /api/bets/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM user_bets WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Bet not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete bet' });
  }
});

// PUT /api/bets/:id/legs/:legNum — settle individual leg
router.put('/:id/legs/:legNum', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['won', 'lost', 'push', 'void'].includes(status)) {
      return res.status(400).json({ error: 'status must be won, lost, push, or void' });
    }
    // Verify bet belongs to user
    const { rows: betRows } = await db.query('SELECT id FROM user_bets WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!betRows.length) return res.status(404).json({ error: 'Bet not found' });

    const { rows } = await db.query(
      `UPDATE bet_legs SET status = $1, settled_at = NOW() WHERE bet_id = $2 AND leg_number = $3 RETURNING *`,
      [status, req.params.id, parseInt(req.params.legNum)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Leg not found' });

    // Auto-resolve parent if all legs settled
    const { rows: allLegs } = await db.query('SELECT status FROM bet_legs WHERE bet_id = $1', [req.params.id]);
    const pending = allLegs.filter(l => l.status === 'pending');
    if (pending.length === 0) {
      const hasLoss = allLegs.some(l => l.status === 'lost');
      const allVoid = allLegs.every(l => l.status === 'void' || l.status === 'push');
      const parentStatus = hasLoss ? 'lost' : allVoid ? 'push' : 'won';

      // For won parlays, result_amount = potential_win
      const updateQ = parentStatus === 'won'
        ? `UPDATE user_bets SET status = $1, settled_at = NOW(), result_amount = potential_win WHERE id = $2`
        : `UPDATE user_bets SET status = $1, settled_at = NOW(), result_amount = 0 WHERE id = $2`;
      await db.query(updateQ, [parentStatus, req.params.id]);
    }

    res.json({ leg: rows[0], all_legs: allLegs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update leg', message: err.message });
  }
});

// PUT /api/bets/:id/cashout — record cash out
router.put('/:id/cashout', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'amount required' });
    const { rows } = await db.query(
      `UPDATE user_bets SET cash_out = $1, status = 'cashed_out', result_amount = $1, settled_at = NOW()
       WHERE id = $2 AND user_id = $3 RETURNING *`,
      [amount, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Bet not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to cash out', message: err.message });
  }
});

// ═══════════════════════════════════════════
//  SUMMARY / P&L
// ═══════════════════════════════════════════

router.get('/summary', async (req, res) => {
  try {
    const { rows: bets } = await db.query(
      'SELECT * FROM user_bets WHERE user_id = $1', [req.user.id]
    );
    const { rows: books } = await db.query(
      'SELECT * FROM user_sportsbooks WHERE user_id = $1', [req.user.id]
    );

    const active = bets.filter(b => b.status === 'active');
    const settled = bets.filter(b => ['won', 'lost', 'push'].includes(b.status));
    const wins = settled.filter(b => b.status === 'won');
    const losses = settled.filter(b => b.status === 'lost');

    const totalStaked = settled.reduce((s, b) => s + parseFloat(b.stake || 0), 0);
    const totalWon = wins.reduce((s, b) => s + parseFloat(b.result_amount || b.potential_win || 0), 0);
    const totalLost = losses.reduce((s, b) => s + parseFloat(b.stake || 0), 0);
    const pnl = totalWon - totalLost;
    const roi = totalStaked > 0 ? ((pnl / totalStaked) * 100).toFixed(1) : '0.0';

    const totalBankroll = books.reduce((s, b) => s + parseFloat(b.balance || 0), 0);
    const activeExposure = active.reduce((s, b) => s + parseFloat(b.stake || 0), 0);

    res.json({
      bankroll: totalBankroll,
      active_count: active.length,
      active_exposure: activeExposure,
      total_bets: bets.length,
      wins: wins.length,
      losses: losses.length,
      pushes: settled.filter(b => b.status === 'push').length,
      win_rate: settled.length > 0 ? ((wins.length / settled.length) * 100).toFixed(1) : '0.0',
      pnl: pnl.toFixed(2),
      roi,
      total_staked: totalStaked.toFixed(2),
      total_won: totalWon.toFixed(2),
      books: books.length
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to build summary', message: err.message });
  }
});

// ═══════════════════════════════════════════
//  SCREENSHOT OCR (OpenAI Vision)
// ═══════════════════════════════════════════

router.post('/parse-screenshot', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'OpenAI not configured' });
    }

    const { image_base64, image_url } = req.body;
    if (!image_base64 && !image_url) {
      return res.status(400).json({ error: 'image_base64 or image_url required' });
    }

    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const imageContent = image_url
      ? { type: 'image_url', image_url: { url: image_url } }
      : { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image_base64}` } };

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Extract bet details from this sportsbook bet slip screenshot. Return a JSON object with these fields:
{
  "book_name": "DraftKings",
  "book_slug": "draftkings",
  "bet_type": "spread|moneyline|total|prop|parlay",
  "pick": "BOS Celtics -6.5",
  "odds": -110,
  "stake": 50.00,
  "potential_win": 45.45,
  "sport": "nba",
  "home_team": "Boston Celtics",
  "away_team": "Milwaukee Bucks",
  "game_time": null,
  "legs": []
}
For parlays, include individual legs in the "legs" array. If you can't determine a field, set it to null. Return ONLY valid JSON, no markdown.` },
          imageContent
        ]
      }],
      max_tokens: 800,
      temperature: 0
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    } catch {
      parsed = { raw_text: raw, parse_error: true };
    }

    res.json({ parsed, raw_response: raw });
  } catch (err) {
    console.error('Screenshot parse error:', err.message);
    res.status(500).json({ error: 'Failed to parse screenshot', message: err.message });
  }
});

// ═══════════════════════════════════════════
//  EMAIL PARSING
// ═══════════════════════════════════════════

router.post('/parse-email', async (req, res) => {
  try {
    const { email_body, subject } = req.body;
    if (!email_body) return res.status(400).json({ error: 'email_body required' });

    // Try pattern matching first for known books
    let parsed = parseKnownBookEmail(email_body, subject);

    // Fallback to GPT if pattern matching fails
    if (!parsed && process.env.OPENAI_API_KEY) {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: 'Extract bet details from sportsbook confirmation emails. Return ONLY valid JSON with fields: book_name, book_slug, bet_type, pick, odds, stake, potential_win, sport, home_team, away_team, game_time, confirmation_number. Set unknown fields to null.'
        }, {
          role: 'user',
          content: `Subject: ${subject || 'N/A'}\n\nBody:\n${email_body}`
        }],
        max_tokens: 500,
        temperature: 0
      });

      const raw = completion.choices[0]?.message?.content || '{}';
      try {
        parsed = JSON.parse(raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      } catch {
        parsed = null;
      }
    }

    if (!parsed) return res.status(422).json({ error: 'Could not parse email' });
    res.json({ parsed });
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse email', message: err.message });
  }
});

// Pattern matching for known sportsbook emails
function parseKnownBookEmail(body, subject) {
  const text = (body || '').toLowerCase();

  // DraftKings pattern
  if (text.includes('draftkings') || (subject || '').toLowerCase().includes('draftkings')) {
    const stakeMatch = body.match(/(?:wager|stake|risk)[:\s]*\$?([\d,.]+)/i);
    const oddsMatch = body.match(/([+-]\d{3,})/);
    const pickMatch = body.match(/(?:pick|selection)[:\s]*(.+?)(?:\n|$)/i);
    const winMatch = body.match(/(?:to win|potential|payout)[:\s]*\$?([\d,.]+)/i);
    if (stakeMatch || pickMatch) {
      return {
        book_name: 'DraftKings', book_slug: 'draftkings',
        stake: stakeMatch ? parseFloat(stakeMatch[1].replace(',', '')) : null,
        odds: oddsMatch ? parseInt(oddsMatch[1]) : null,
        pick: pickMatch ? pickMatch[1].trim() : null,
        potential_win: winMatch ? parseFloat(winMatch[1].replace(',', '')) : null,
        bet_type: 'spread', sport: null, home_team: null, away_team: null, game_time: null
      };
    }
  }

  // FanDuel pattern
  if (text.includes('fanduel') || (subject || '').toLowerCase().includes('fanduel')) {
    const stakeMatch = body.match(/(?:wager|stake|risk)[:\s]*\$?([\d,.]+)/i);
    const oddsMatch = body.match(/([+-]\d{3,})/);
    const pickMatch = body.match(/(?:your bet|selection)[:\s]*(.+?)(?:\n|$)/i);
    const winMatch = body.match(/(?:to win|potential|payout)[:\s]*\$?([\d,.]+)/i);
    if (stakeMatch || pickMatch) {
      return {
        book_name: 'FanDuel', book_slug: 'fanduel',
        stake: stakeMatch ? parseFloat(stakeMatch[1].replace(',', '')) : null,
        odds: oddsMatch ? parseInt(oddsMatch[1]) : null,
        pick: pickMatch ? pickMatch[1].trim() : null,
        potential_win: winMatch ? parseFloat(winMatch[1].replace(',', '')) : null,
        bet_type: 'spread', sport: null, home_team: null, away_team: null, game_time: null
      };
    }
  }

  // BetMGM pattern
  if (text.includes('betmgm') || (subject || '').toLowerCase().includes('betmgm')) {
    const stakeMatch = body.match(/(?:wager|stake|bet amount)[:\s]*\$?([\d,.]+)/i);
    const oddsMatch = body.match(/([+-]\d{3,})/);
    const pickMatch = body.match(/(?:selection|your pick)[:\s]*(.+?)(?:\n|$)/i);
    const winMatch = body.match(/(?:to win|potential|returns)[:\s]*\$?([\d,.]+)/i);
    if (stakeMatch || pickMatch) {
      return {
        book_name: 'BetMGM', book_slug: 'betmgm',
        stake: stakeMatch ? parseFloat(stakeMatch[1].replace(',', '')) : null,
        odds: oddsMatch ? parseInt(oddsMatch[1]) : null,
        pick: pickMatch ? pickMatch[1].trim() : null,
        potential_win: winMatch ? parseFloat(winMatch[1].replace(',', '')) : null,
        bet_type: 'spread', sport: null, home_team: null, away_team: null, game_time: null
      };
    }
  }

  return null;
}

export default router;
