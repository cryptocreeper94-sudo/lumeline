/**
 * ═══════════════════════════════════════════════════
 *  LumeLine — House Accuracy Tracker
 *  Scores each bookmaker against actual game results
 *  Answers: "How often is the house actually right?"
 * ═══════════════════════════════════════════════════
 */
import db from './db.js';

// ─── Record a game result and score all books ───
export async function recordResult(gameId, homeScore, awayScore) {
  const actualSpread = homeScore - awayScore;
  const actualTotal = homeScore + awayScore;
  const actualWinner = homeScore > awayScore ? 'home' : 'away';

  // Store the result
  await db.query(`
    INSERT INTO game_results (game_id, final_home_score, final_away_score, actual_spread, actual_total, actual_winner)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT DO NOTHING
  `, [gameId, homeScore, awayScore, actualSpread, actualTotal, actualWinner]);

  // Update game status
  await db.query(`
    UPDATE games SET status = 'final', home_score = $2, away_score = $3, 
    winner = $4, updated_at = NOW() WHERE id = $1
  `, [gameId, homeScore, awayScore, actualWinner]);

  // Score every snapshot for this game
  await scoreSnapshotsForGame(gameId, actualSpread, actualTotal, actualWinner);
  
  console.log(`📊 Result recorded: Game ${gameId} — ${homeScore}-${awayScore}`);
  return { actualSpread, actualTotal, actualWinner };
}

// ─── Score each bookmaker's prediction against reality ───
async function scoreSnapshotsForGame(gameId, actualSpread, actualTotal, actualWinner) {
  // Get the LAST snapshot per source per market (their final line before game time)
  const { rows: finalLines } = await db.query(`
    SELECT DISTINCT ON (source_id, market) 
      source_id, market, line, odds_home, odds_away, over_under
    FROM odds_snapshots 
    WHERE game_id = $1
    ORDER BY source_id, market, captured_at DESC
  `, [gameId]);

  for (const snap of finalLines) {
    let wasCorrect = false;
    let deviation = 0;

    if (snap.market === 'spread' && snap.line !== null) {
      // Spread: house set home at -3.5. Actual spread was -7. House correct if home covered.
      const adjustedSpread = actualSpread + snap.line; // positive = home covered
      wasCorrect = adjustedSpread > 0 ? true : adjustedSpread < 0 ? false : null; // null = push
      deviation = Math.abs(actualSpread - (-snap.line)); // how far off was the line?
    }

    if (snap.market === 'moneyline') {
      // Moneyline: did the favorite actually win?
      const predictedWinner = snap.odds_home < snap.odds_away ? 'home' : 'away';
      wasCorrect = predictedWinner === actualWinner;
      deviation = 0;
    }

    if (snap.market === 'total' && snap.over_under !== null) {
      // Total: did the actual total match the house O/U?
      const wentOver = actualTotal > snap.over_under;
      // House is "correct" if the total was within 3 points of their line
      wasCorrect = Math.abs(actualTotal - snap.over_under) <= 3;
      deviation = Math.abs(actualTotal - snap.over_under);
    }

    // Log the accuracy data point
    if (wasCorrect !== null) {
      await updateRunningAccuracy(snap.source_id, snap.market, gameId, wasCorrect, deviation);
    }
  }
}

// ─── Update rolling accuracy stats for a source ───
async function updateRunningAccuracy(sourceId, market, gameId, wasCorrect, deviation) {
  const { rows: gameRows } = await db.query('SELECT sport FROM games WHERE id = $1', [gameId]);
  const sport = gameRows[0]?.sport || 'unknown';

  // Upsert into house_accuracy for each period
  for (const period of ['7d', '30d', '90d', 'all']) {
    await db.query(`
      INSERT INTO house_accuracy (source_id, market, sport, period, total_games, correct, accuracy_pct, avg_deviation)
      VALUES ($1, $2, $3, $4, 1, $5, $6, $7)
      ON CONFLICT (source_id, market, sport, period) 
      DO UPDATE SET 
        total_games = house_accuracy.total_games + 1,
        correct = house_accuracy.correct + $5,
        accuracy_pct = ROUND(100.0 * (house_accuracy.correct + $5) / (house_accuracy.total_games + 1), 2),
        avg_deviation = ROUND(((house_accuracy.avg_deviation * house_accuracy.total_games) + $7) / (house_accuracy.total_games + 1), 2),
        calculated_at = NOW()
    `, [sourceId, market, sport, period, wasCorrect ? 1 : 0, wasCorrect ? 100 : 0, deviation]);
  }
}

// ─── Get the house report card (all sources ranked) ───
export async function getHouseReportCard(market = 'spread', sport = null, period = '30d') {
  const q = sport
    ? `SELECT * FROM v_house_report_card WHERE market = $1 AND sport = $2 AND period = $3`
    : `SELECT * FROM v_house_report_card WHERE market = $1 AND period = $2`;
  const params = sport ? [market, sport, period] : [market, period];
  const { rows } = await db.query(q, params);
  return rows;
}

// ─── Identify which books are MOST wrong (fade targets) ───
export async function getFadeTargets(market = 'spread', period = '30d') {
  const { rows } = await db.query(`
    SELECT source_name, slug, tier, market, accuracy_pct, avg_deviation, bias, total_games
    FROM v_house_report_card
    WHERE market = $1 AND period = $2 AND total_games >= 10
    ORDER BY accuracy_pct ASC
    LIMIT 5
  `, [market, period]);
  return rows;
}

// ─── Identify which books are MOST right (follow targets) ───
export async function getSharpBooks(market = 'spread', period = '30d') {
  const { rows } = await db.query(`
    SELECT source_name, slug, tier, market, accuracy_pct, avg_deviation, bias, total_games
    FROM v_house_report_card
    WHERE market = $1 AND period = $2 AND total_games >= 10
    ORDER BY accuracy_pct DESC
    LIMIT 5
  `, [market, period]);
  return rows;
}

// ─── Calculate house bias (does the house favor home or away?) ───
export async function getHouseBias(sourceSlug, sport = null) {
  const source = await db.getSourceBySlug(sourceSlug);
  if (!source) return null;

  const q = sport
    ? `SELECT bias, avg_deviation, accuracy_pct, best_matchup, worst_matchup 
       FROM house_accuracy WHERE source_id = $1 AND market = 'spread' AND sport = $2 AND period = '30d'`
    : `SELECT bias, avg_deviation, accuracy_pct, best_matchup, worst_matchup 
       FROM house_accuracy WHERE source_id = $1 AND market = 'spread' AND period = '30d'`;
  const params = sport ? [source.id, sport] : [source.id];
  const { rows } = await db.query(q, params);
  return rows[0] || null;
}

export default { recordResult, getHouseReportCard, getFadeTargets, getSharpBooks, getHouseBias };
