/**
 * ═══════════════════════════════════════════════════════════
 *  LumeLine — House Decoder Engine
 *  Predicts WHEN the house is right vs wrong
 *  Identifies traps, public bait, and true value lines
 *  Answers: "Is this line real, or is it a setup?"
 * ═══════════════════════════════════════════════════════════
 */
import db from './db.js';

// ─── Analyze a game and generate decoder signals ───
export async function decodeGame(gameId) {
  const { rows: gameRows } = await db.query('SELECT * FROM games WHERE id = $1', [gameId]);
  if (!gameRows.length) return [];
  const game = gameRows[0];

  // Get all latest snapshots for this game
  const { rows: snapshots } = await db.query(`
    SELECT DISTINCT ON (source_id, market)
      os.*, s.name as source_name, s.slug, s.tier
    FROM odds_snapshots os
    JOIN sources s ON os.source_id = s.id
    WHERE os.game_id = $1
    ORDER BY source_id, market, captured_at DESC
  `, [gameId]);

  const signals = [];

  // ═══ Signal 1: Sharp vs Recreational Divergence ═══
  const sharpDivergence = detectSharpDivergence(snapshots, game);
  if (sharpDivergence) signals.push(sharpDivergence);

  // ═══ Signal 2: Total Mismatch (O/U vs matchup history) ═══
  const totalMismatch = await detectTotalMismatch(snapshots, game);
  if (totalMismatch) signals.push(totalMismatch);

  // ═══ Signal 3: Public Bait Line ═══
  const publicBait = detectPublicBait(snapshots, game);
  if (publicBait) signals.push(publicBait);

  // ═══ Signal 4: Inflection Point ═══
  const inflection = await detectInflectionPoint(gameId, game);
  if (inflection) signals.push(inflection);

  // ═══ Signal 5: Reverse Indicator (fade the house) ═══
  const reverseIndicator = await detectReverseIndicator(snapshots, game);
  if (reverseIndicator) signals.push(reverseIndicator);

  // Store all signals
  for (const sig of signals) {
    await db.query(`
      INSERT INTO decoder_signals (game_id, signal_type, market, description, confidence, prediction, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [gameId, sig.signal_type, sig.market, sig.description, sig.confidence, sig.prediction, JSON.stringify(sig.metadata || {})]);
  }

  if (signals.length) {
    console.log(`🔍 Decoded game ${game.away_team} @ ${game.home_team}: ${signals.length} signals`);
  }

  return signals;
}

// ═══ SIGNAL DETECTORS ═══

/**
 * Sharp books (Pinnacle, Circa) disagree with recreational books (FanDuel, BetMGM)
 * When sharps diverge from recs, sharps are historically right ~68% of the time
 */
function detectSharpDivergence(snapshots, game) {
  const spreads = snapshots.filter(s => s.market === 'spread' && s.line !== null);
  const sharpSpreads = spreads.filter(s => s.tier === 'sharp').map(s => parseFloat(s.line));
  const recSpreads = spreads.filter(s => s.tier !== 'sharp' && s.tier !== 'unranked').map(s => parseFloat(s.line));

  if (sharpSpreads.length < 2 || recSpreads.length < 2) return null;

  const sharpAvg = sharpSpreads.reduce((a, b) => a + b, 0) / sharpSpreads.length;
  const recAvg = recSpreads.reduce((a, b) => a + b, 0) / recSpreads.length;
  const divergence = Math.abs(sharpAvg - recAvg);

  if (divergence >= 1.5) {
    const sharpFavor = sharpAvg < recAvg ? game.home_team : game.away_team;
    return {
      signal_type: 'sharp_divergence',
      market: 'spread',
      description: `Sharp books (avg ${sharpAvg.toFixed(1)}) diverge from recreational books (avg ${recAvg.toFixed(1)}) by ${divergence.toFixed(1)} pts. Sharps favor ${sharpFavor}.`,
      confidence: Math.min(90, Math.round(50 + divergence * 15)),
      prediction: `Follow sharps: ${sharpFavor} likely has value`,
      metadata: { sharpAvg, recAvg, divergence, sharpFavor }
    };
  }
  return null;
}

/**
 * The house O/U doesn't match the matchup's historical scoring pattern
 * If KC vs DEN averages 47 pts but the line is set at 52, something's off
 */
async function detectTotalMismatch(snapshots, game) {
  const totals = snapshots.filter(s => s.market === 'total' && s.over_under).map(s => parseFloat(s.over_under));
  if (totals.length < 2) return null;

  const consensusOU = totals.sort((a, b) => a - b)[Math.floor(totals.length / 2)];

  // Check matchup history
  const { rows: matchups } = await db.query(`
    SELECT avg_total, games_played, overs, unders FROM matchup_patterns
    WHERE home_team = $1 AND away_team = $2 AND sport = $3
  `, [game.home_team, game.away_team, game.sport]);

  if (!matchups.length || matchups[0].games_played < 3) return null;

  const histAvg = parseFloat(matchups[0].avg_total);
  const delta = consensusOU - histAvg;
  const overPct = (matchups[0].overs / matchups[0].games_played * 100).toFixed(0);

  if (Math.abs(delta) >= 3) {
    const direction = delta > 0 ? 'higher' : 'lower';
    return {
      signal_type: 'total_mismatch',
      market: 'total',
      description: `House O/U (${consensusOU}) is ${Math.abs(delta).toFixed(1)} pts ${direction} than matchup avg (${histAvg}). This matchup goes over ${overPct}% of the time (${matchups[0].games_played} games).`,
      confidence: Math.min(85, Math.round(40 + Math.abs(delta) * 8)),
      prediction: delta > 0 ? `Under looks attractive — house may be inflating the total` : `Over looks attractive — house may be deflating the total`,
      metadata: { consensusOU, histAvg, delta, overPct }
    };
  }
  return null;
}

/**
 * Line is set at a "key number" that attracts public money
 * NFL: 3, 7, 10, 14 are key numbers (most common margins of victory)
 * NBA: 5, 7, 8 are common
 */
function detectPublicBait(snapshots, game) {
  const spreads = snapshots.filter(s => s.market === 'spread' && s.line !== null);
  if (spreads.length < 3) return null;

  const lines = spreads.map(s => Math.abs(parseFloat(s.line)));
  const avgLine = lines.reduce((a, b) => a + b, 0) / lines.length;

  const nflKeyNumbers = [3, 3.5, 7, 7.5, 10, 10.5, 14, 14.5];
  const nbaKeyNumbers = [5, 5.5, 7, 7.5, 8, 8.5];
  const keyNumbers = game.sport === 'NFL' ? nflKeyNumbers : nbaKeyNumbers;

  // Check if most books converged on a key number
  const onKeyNumber = lines.filter(l => keyNumbers.includes(l));
  const keyPct = (onKeyNumber.length / lines.length * 100);

  if (keyPct >= 80 && lines.length >= 4) {
    const keyNum = onKeyNumber[0];
    return {
      signal_type: 'public_bait',
      market: 'spread',
      description: `${keyPct.toFixed(0)}% of books have this at a key number (${keyNum}). Key numbers attract public money and often represent inflated lines.`,
      confidence: 55,
      prediction: `Line may be shaded toward the popular side. Look for value on the less popular side.`,
      metadata: { keyNum, keyPct, totalBooks: lines.length }
    };
  }
  return null;
}

/**
 * Line moved significantly (>1.5 pts) and then settled back
 * This usually means the house found the true value after initial volatility
 */
async function detectInflectionPoint(gameId, game) {
  const { rows: history } = await db.query(`
    SELECT line, captured_at FROM odds_snapshots
    WHERE game_id = $1 AND market = 'spread' AND line IS NOT NULL
    ORDER BY captured_at ASC
  `, [gameId]);

  if (history.length < 4) return null;

  const lines = history.map(h => parseFloat(h.line));
  const max = Math.max(...lines);
  const min = Math.min(...lines);
  const range = max - min;
  const current = lines[lines.length - 1];
  const opening = lines[0];
  const moved = Math.abs(current - opening);

  if (range >= 2.0 && moved >= 1.0) {
    return {
      signal_type: 'inflection_point',
      market: 'spread',
      description: `Line moved ${range.toFixed(1)} pts total (opened ${opening > 0 ? '+' : ''}${opening.toFixed(1)}, currently ${current > 0 ? '+' : ''}${current.toFixed(1)}). Significant movement suggests the house adjusted to real information.`,
      confidence: Math.min(80, Math.round(45 + range * 10)),
      prediction: `Current line likely closer to true value. Movement direction suggests ${current < opening ? 'home' : 'away'} side getting sharper action.`,
      metadata: { opening, current, max, min, range, moved, totalMoves: history.length }
    };
  }
  return null;
}

/**
 * The house is historically WRONG on this specific source + market combo
 * If Caesars is only 42% accurate on NFL spreads, fade them
 */
async function detectReverseIndicator(snapshots, game) {
  const fadeBooks = [];

  for (const snap of snapshots.filter(s => s.market === 'spread')) {
    const { rows } = await db.query(`
      SELECT accuracy_pct, total_games FROM house_accuracy
      WHERE source_id = $1 AND market = 'spread' AND sport = $2 AND period = '30d'
    `, [snap.source_id, game.sport]);

    if (rows.length && rows[0].total_games >= 10 && rows[0].accuracy_pct < 45) {
      fadeBooks.push({
        name: snap.source_name,
        accuracy: rows[0].accuracy_pct,
        line: snap.line
      });
    }
  }

  if (fadeBooks.length >= 2) {
    const names = fadeBooks.map(b => b.name).join(', ');
    const avgLine = fadeBooks.reduce((a, b) => a + parseFloat(b.line), 0) / fadeBooks.length;
    return {
      signal_type: 'reverse_indicator',
      market: 'spread',
      description: `${fadeBooks.length} books with <45% accuracy (${names}) are aligned. Their recent track record suggests fading their line has value.`,
      confidence: Math.min(75, Math.round(40 + fadeBooks.length * 10)),
      prediction: `Consider the opposite of what ${names} are setting. Their consensus line: ${avgLine > 0 ? '+' : ''}${avgLine.toFixed(1)}`,
      metadata: { fadeBooks }
    };
  }
  return null;
}

// ─── Get all active decoder signals for a game ───
export async function getSignals(gameId) {
  const { rows } = await db.query(`
    SELECT * FROM decoder_signals WHERE game_id = $1 ORDER BY confidence DESC
  `, [gameId]);
  return rows;
}

// ─── Get all recent signals across all games ───
export async function getRecentSignals(limit = 20) {
  const { rows } = await db.query(`
    SELECT ds.*, g.home_team, g.away_team, g.sport, g.start_time
    FROM decoder_signals ds
    JOIN games g ON ds.game_id = g.id
    WHERE g.status IN ('upcoming', 'live')
    ORDER BY ds.detected_at DESC
    LIMIT $1
  `, [limit]);
  return rows;
}

// ─── Score past signals against results (learning loop) ───
export async function scoreSignals() {
  // Get unscored signals for completed games
  const { rows } = await db.query(`
    SELECT ds.id, ds.signal_type, ds.market, ds.prediction, ds.metadata, ds.game_id,
           gr.actual_spread, gr.actual_total, gr.actual_winner
    FROM decoder_signals ds
    JOIN game_results gr ON ds.game_id = gr.game_id
    WHERE ds.was_correct IS NULL
  `);

  let scored = 0;
  for (const sig of rows) {
    let wasCorrect = null;

    // Score based on signal type
    if (sig.signal_type === 'sharp_divergence' && sig.metadata?.sharpAvg !== undefined) {
      // Were the sharps right?
      const sharpPredictedHome = sig.metadata.sharpAvg < sig.metadata.recAvg;
      const homeWon = sig.actual_winner === 'home';
      wasCorrect = sharpPredictedHome === homeWon;
    }

    if (sig.signal_type === 'total_mismatch' && sig.metadata?.delta !== undefined) {
      // Did the mismatch predict the right direction?
      const predictedUnder = sig.metadata.delta > 0;
      const actuallyWentUnder = sig.actual_total < sig.metadata.consensusOU;
      wasCorrect = predictedUnder === actuallyWentUnder;
    }

    if (wasCorrect !== null) {
      await db.query('UPDATE decoder_signals SET was_correct = $2 WHERE id = $1', [sig.id, wasCorrect]);
      scored++;
    }
  }

  console.log(`🧠 Scored ${scored} decoder signals against results`);
  return { scored };
}

// ─── Get decoder accuracy (how good is our decoder?) ───
export async function getDecoderAccuracy() {
  const { rows } = await db.query(`
    SELECT signal_type,
      COUNT(*) AS total,
      SUM(CASE WHEN was_correct THEN 1 ELSE 0 END) AS correct,
      ROUND(100.0 * SUM(CASE WHEN was_correct THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS accuracy_pct
    FROM decoder_signals
    WHERE was_correct IS NOT NULL
    GROUP BY signal_type
    ORDER BY accuracy_pct DESC
  `);
  return rows;
}

export default { decodeGame, getSignals, getRecentSignals, scoreSignals, getDecoderAccuracy };
