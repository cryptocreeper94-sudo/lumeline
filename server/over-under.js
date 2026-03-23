/**
 * ═══════════════════════════════════════════════════
 *  LumeLine — Over/Under Analyzer
 *  Breaks down O/U patterns that most bettors ignore
 *  Answers: "When is the house wrong on totals?"
 * ═══════════════════════════════════════════════════
 */
import db from './db.js';

// ─── Record O/U result for a completed game ───
export async function recordOUResult(gameId) {
  // Get game result
  const { rows: results } = await db.query(
    'SELECT * FROM game_results WHERE game_id = $1', [gameId]
  );
  if (!results.length) return null;
  const result = results[0];

  // Get the consensus total (median O/U line across all books)
  const { rows: totalLines } = await db.query(`
    SELECT DISTINCT ON (source_id) over_under 
    FROM odds_snapshots 
    WHERE game_id = $1 AND market = 'total' AND over_under IS NOT NULL
    ORDER BY source_id, captured_at DESC
  `, [gameId]);

  if (!totalLines.length) return null;

  const totals = totalLines.map(r => parseFloat(r.over_under)).filter(v => !isNaN(v));
  if (!totals.length) return null;

  // Sort and get median
  totals.sort((a, b) => a - b);
  const consensusTotal = totals[Math.floor(totals.length / 2)];
  const delta = result.actual_total - consensusTotal;
  const wentOver = result.actual_total > consensusTotal;
  const maxOu = Math.max(...totals);
  const minOu = Math.min(...totals);

  await db.query(`
    INSERT INTO ou_analysis (game_id, consensus_total, actual_total, delta, went_over, 
      num_sources_over, num_sources_under, ou_consensus_spread)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT DO NOTHING
  `, [
    gameId, consensusTotal, result.actual_total, delta, wentOver,
    totals.filter(t => t > consensusTotal).length,
    totals.filter(t => t < consensusTotal).length,
    maxOu - minOu
  ]);

  // Update matchup pattern
  await updateMatchupOU(gameId, result, consensusTotal);

  console.log(`📊 O/U logged: Game ${gameId} — Line ${consensusTotal}, Actual ${result.actual_total} (${wentOver ? 'OVER' : 'UNDER'} by ${Math.abs(delta).toFixed(1)})`);
  return { consensusTotal, actualTotal: result.actual_total, delta, wentOver };
}

// ─── Update matchup-level O/U patterns ───
async function updateMatchupOU(gameId, result, consensusTotal) {
  const { rows: gameRows } = await db.query('SELECT * FROM games WHERE id = $1', [gameId]);
  if (!gameRows.length) return;
  const game = gameRows[0];

  const wentOver = result.actual_total > consensusTotal;
  const spreadAccuracy = Math.abs(result.actual_spread - 0) <= 3 ? 1 : 0; // placeholder
  const totalAccuracy = Math.abs(result.actual_total - consensusTotal) <= 3 ? 1 : 0;

  await db.query(`
    INSERT INTO matchup_patterns (home_team, away_team, sport, games_played, 
      home_covers, away_covers, overs, unders, avg_total, avg_spread, 
      house_total_accuracy)
    VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (home_team, away_team, sport)
    DO UPDATE SET
      games_played = matchup_patterns.games_played + 1,
      home_covers = matchup_patterns.home_covers + $4,
      away_covers = matchup_patterns.away_covers + $5,
      overs = matchup_patterns.overs + $6,
      unders = matchup_patterns.unders + $7,
      avg_total = ROUND(((matchup_patterns.avg_total * matchup_patterns.games_played) + $8) / (matchup_patterns.games_played + 1), 1),
      avg_spread = ROUND(((matchup_patterns.avg_spread * matchup_patterns.games_played) + $9) / (matchup_patterns.games_played + 1), 1),
      house_total_accuracy = ROUND(((matchup_patterns.house_total_accuracy * matchup_patterns.games_played) + $10) / (matchup_patterns.games_played + 1), 2),
      last_updated = NOW()
  `, [
    game.home_team, game.away_team, game.sport,
    result.actual_ats_winner === 'home' ? 1 : 0,
    result.actual_ats_winner === 'away' ? 1 : 0,
    wentOver ? 1 : 0,
    wentOver ? 0 : 1,
    result.actual_total,
    result.actual_spread,
    totalAccuracy * 100
  ]);
}

// ─── Get O/U trends (league-wide) ───
export async function getOUTrends(sport = null) {
  const q = sport
    ? `SELECT * FROM v_ou_trends WHERE sport = $1`
    : `SELECT * FROM v_ou_trends`;
  const { rows } = sport ? await db.query(q, [sport]) : await db.query(q);
  return rows;
}

// ─── Get O/U edge: games where house was consistently wrong ───
export async function getOUEdge(sport = null, minGames = 5) {
  const q = `
    SELECT home_team, away_team, sport, games_played, overs, unders,
      ROUND(100.0 * overs / NULLIF(games_played, 0), 1) AS over_pct,
      avg_total, house_total_accuracy
    FROM matchup_patterns
    WHERE games_played >= $1 ${sport ? 'AND sport = $2' : ''}
      AND house_total_accuracy < 50
    ORDER BY house_total_accuracy ASC
    LIMIT 20
  `;
  const params = sport ? [minGames, sport] : [minGames];
  const { rows } = await db.query(q, params);
  return rows;
}

// ─── Get matchups that always go OVER ───
export async function getOverMatchups(sport = null, minGames = 3) {
  const { rows } = await db.query(`
    SELECT home_team, away_team, sport, games_played, overs, unders,
      ROUND(100.0 * overs / NULLIF(games_played, 0), 1) AS over_pct,
      avg_total
    FROM matchup_patterns
    WHERE games_played >= $1 ${sport ? 'AND sport = $2' : ''}
    ORDER BY (100.0 * overs / NULLIF(games_played, 0)) DESC
    LIMIT 15
  `, sport ? [minGames, sport] : [minGames]);
  return rows;
}

// ─── Get matchups that always go UNDER ───
export async function getUnderMatchups(sport = null, minGames = 3) {
  const { rows } = await db.query(`
    SELECT home_team, away_team, sport, games_played, overs, unders,
      ROUND(100.0 * unders / NULLIF(games_played, 0), 1) AS under_pct,
      avg_total
    FROM matchup_patterns
    WHERE games_played >= $1 ${sport ? 'AND sport = $2' : ''}
    ORDER BY (100.0 * unders / NULLIF(games_played, 0)) DESC
    LIMIT 15
  `, sport ? [minGames, sport] : [minGames]);
  return rows;
}

export default { recordOUResult, getOUTrends, getOUEdge, getOverMatchups, getUnderMatchups };
