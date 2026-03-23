// ═══════════════════════════════════════════
//  LumeLine — Outcome Evaluation Engine
//  Checks game results, evaluates consensus accuracy,
//  and updates rolling stats (modeled after Pulse)
// ═══════════════════════════════════════════

import db from './db.js';

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4';

// ═══ Fetch completed game scores from The Odds API ═══
async function fetchScores(sport) {
  const url = `${ODDS_API_BASE}/sports/${sport}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`Scores API ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    return data.filter(g => g.completed);
  } catch (err) {
    console.error(`   ❌ Error fetching scores for ${sport}:`, err.message);
    return [];
  }
}

// ═══ Map API sport key to our sport name ═══
const SPORT_MAP = {
  'americanfootball_nfl': 'NFL', 'americanfootball_ncaaf': 'NCAAF',
  'basketball_nba': 'NBA', 'basketball_ncaab': 'NCAAB', 'basketball_wnba': 'WNBA',
  'baseball_mlb': 'MLB', 'icehockey_nhl': 'NHL',
  'soccer_epl': 'EPL', 'soccer_spain_la_liga': 'La Liga', 'soccer_usa_mls': 'MLS',
  'mma_mixed_martial_arts': 'UFC', 'tennis_atp': 'Tennis',
  'cricket_ipl': 'Cricket', 'rugbyleague_nrl': 'Rugby',
};

// ═══ Evaluate a single game's outcome ═══
async function evaluateGame(apiGame) {
  // Find matching game in our DB
  const { rows } = await db.query(
    'SELECT * FROM games WHERE external_id = $1', [apiGame.id]
  );
  if (!rows.length) return null;
  const game = rows[0];

  // Already evaluated?
  const { rows: existing } = await db.query(
    'SELECT id FROM game_outcomes WHERE game_id = $1', [game.id]
  );
  if (existing.length) return null;

  // Parse scores
  const homeScore = apiGame.scores?.find(s => s.name === apiGame.home_team);
  const awayScore = apiGame.scores?.find(s => s.name === apiGame.away_team);
  if (!homeScore || !awayScore) return null;

  const hScore = parseInt(homeScore.score);
  const aScore = parseInt(awayScore.score);
  if (isNaN(hScore) || isNaN(aScore)) return null;

  const winner = hScore > aScore ? 'home' : hScore < aScore ? 'away' : 'push';
  const totalPoints = hScore + aScore;

  // Update the game record
  await db.query(
    `UPDATE games SET status = 'final', home_score = $1, away_score = $2, winner = $3, updated_at = NOW() WHERE id = $4`,
    [hScore, aScore, winner, game.id]
  );

  // Insert game outcome
  await db.query(`
    INSERT INTO game_outcomes (game_id, home_score, away_score, winner, total_points)
    VALUES ($1, $2, $3, $4, $5) ON CONFLICT (game_id) DO NOTHING
  `, [game.id, hScore, aScore, winner, totalPoints]);

  // Now evaluate the consensus prediction
  const { rows: consensusRows } = await db.query(
    'SELECT * FROM consensus WHERE game_id = $1 ORDER BY generated_at DESC LIMIT 1',
    [game.id]
  );

  if (consensusRows.length) {
    const consensus = consensusRows[0];
    const predictedWinner = consensus.home_likelihood > consensus.away_likelihood ? 'home' : 'away';
    const isCorrect = winner === 'push' ? false : predictedWinner === winner;
    const outcome = winner === 'push' ? 'PUSH' : (isCorrect ? 'WIN' : 'LOSS');
    const conf = consensus.confidence || 0;
    const bucket = conf >= 70 ? 'high' : conf >= 55 ? 'medium' : 'low';

    await db.query(`
      INSERT INTO consensus_outcomes 
        (game_id, consensus_id, predicted_winner, predicted_confidence, predicted_integrity, 
         predicted_house_lean, actual_winner, is_correct, outcome, confidence_bucket, sport)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (game_id) DO NOTHING
    `, [
      game.id, consensus.id, predictedWinner, conf,
      consensus.integrity || 100, consensus.house_lean || false,
      winner, isCorrect, outcome, bucket, game.sport
    ]);

    console.log(`   ${isCorrect ? '✅' : '❌'} ${game.away_team} @ ${game.home_team}: ${aScore}-${hScore} — Predicted ${predictedWinner} (${conf}%) → ${outcome}`);
    return { game, outcome, isCorrect, confidence: conf };
  }

  return { game, outcome: 'NO_PICK', isCorrect: false };
}

// ═══ Update Aggregated Accuracy Stats ═══
async function updateAccuracyStats() {
  console.log('📊 Updating accuracy stats...');

  const windows = [
    { name: 'all', where: '' },
    { name: '7d', where: "AND co.evaluated_at >= NOW() - INTERVAL '7 days'" },
    { name: '30d', where: "AND co.evaluated_at >= NOW() - INTERVAL '30 days'" },
    { name: '90d', where: "AND co.evaluated_at >= NOW() - INTERVAL '90 days'" },
  ];

  for (const win of windows) {
    // Global stats (all sports, all confidence levels)
    const { rows: global } = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_correct) as correct,
        AVG(predicted_confidence) as avg_conf,
        COUNT(*) FILTER (WHERE confidence_bucket = 'high') as high_total,
        COUNT(*) FILTER (WHERE confidence_bucket = 'high' AND is_correct) as high_correct
      FROM consensus_outcomes co
      WHERE outcome != 'PUSH' ${win.where}
    `);

    if (global[0] && parseInt(global[0].total) > 0) {
      const g = global[0];
      const winRate = (parseInt(g.correct) / parseInt(g.total) * 100).toFixed(2);
      const highRate = parseInt(g.high_total) > 0 
        ? (parseInt(g.high_correct) / parseInt(g.high_total) * 100).toFixed(2) 
        : 0;

      await db.query(`
        INSERT INTO accuracy_stats (sport, confidence_bucket, window, total_predictions, correct_predictions, win_rate, avg_confidence, high_conf_wins, high_conf_total, high_conf_rate, updated_at)
        VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT ((COALESCE(sport, '__ALL__')), (COALESCE(confidence_bucket, '__ALL__')), window) 
        DO UPDATE SET total_predictions = $2, correct_predictions = $3, win_rate = $4, avg_confidence = $5, high_conf_wins = $6, high_conf_total = $7, high_conf_rate = $8, updated_at = NOW()
      `, [win.name, g.total, g.correct, winRate, g.avg_conf || 0, g.high_correct, g.high_total, highRate]);
    }

    // Per-sport stats
    const { rows: sports } = await db.query(`
      SELECT 
        sport,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_correct) as correct,
        AVG(predicted_confidence) as avg_conf,
        COUNT(*) FILTER (WHERE confidence_bucket = 'high') as high_total,
        COUNT(*) FILTER (WHERE confidence_bucket = 'high' AND is_correct) as high_correct
      FROM consensus_outcomes co
      WHERE outcome != 'PUSH' ${win.where}
      GROUP BY sport
    `);

    for (const s of sports) {
      const winRate = (parseInt(s.correct) / parseInt(s.total) * 100).toFixed(2);
      const highRate = parseInt(s.high_total) > 0 
        ? (parseInt(s.high_correct) / parseInt(s.high_total) * 100).toFixed(2) 
        : 0;

      await db.query(`
        INSERT INTO accuracy_stats (sport, confidence_bucket, window, total_predictions, correct_predictions, win_rate, avg_confidence, high_conf_wins, high_conf_total, high_conf_rate, updated_at)
        VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT ((COALESCE(sport, '__ALL__')), (COALESCE(confidence_bucket, '__ALL__')), window) 
        DO UPDATE SET total_predictions = $3, correct_predictions = $4, win_rate = $5, avg_confidence = $6, high_conf_wins = $7, high_conf_total = $8, high_conf_rate = $9, updated_at = NOW()
      `, [s.sport, win.name, s.total, s.correct, winRate, s.avg_conf || 0, s.high_correct, s.high_total, highRate]);
    }
  }

  // Update streaks
  const { rows: recentOutcomes } = await db.query(`
    SELECT is_correct FROM consensus_outcomes WHERE outcome != 'PUSH' ORDER BY evaluated_at DESC LIMIT 100
  `);

  let currentStreak = 0;
  let longestWin = 0, longestLoss = 0;
  let tempStreak = 0;

  for (const o of recentOutcomes) {
    if (currentStreak === 0) {
      currentStreak = o.is_correct ? 1 : -1;
    }

    if (o.is_correct) {
      if (tempStreak >= 0) tempStreak++;
      else { tempStreak = 1; }
      longestWin = Math.max(longestWin, tempStreak);
    } else {
      if (tempStreak <= 0) tempStreak--;
      else { tempStreak = -1; }
      longestLoss = Math.max(longestLoss, Math.abs(tempStreak));
    }
  }

  await db.query(`
    UPDATE accuracy_stats SET current_streak = $1, longest_win_streak = $2, longest_loss_streak = $3
    WHERE sport IS NULL AND confidence_bucket IS NULL AND window = 'all'
  `, [currentStreak, longestWin, longestLoss]);

  console.log('   ✅ Accuracy stats updated');
}

// ═══ Evaluate Source Accuracy ═══
async function evaluateSourceAccuracy() {
  console.log('📊 Evaluating source accuracy...');

  const sources = await db.getSources();
  
  for (const source of sources) {
    // Count correct moneyline predictions (simplest: did the source's favored side win?)
    const { rows } = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE 
          (os.odds_home < os.odds_away AND go.winner = 'home') OR
          (os.odds_away < os.odds_home AND go.winner = 'away')
        ) as correct
      FROM odds_snapshots os
      JOIN game_outcomes go ON go.game_id = os.game_id
      WHERE os.source_id = $1 AND os.market = 'moneyline'
      AND os.captured_at = (
        SELECT MAX(captured_at) FROM odds_snapshots 
        WHERE game_id = os.game_id AND source_id = os.source_id AND market = 'moneyline'
      )
    `, [source.id]);

    if (rows[0] && parseInt(rows[0].total) >= 5) {
      const accuracy = (parseInt(rows[0].correct) / parseInt(rows[0].total) * 100).toFixed(2);

      // Update source accuracy
      const tier = accuracy >= 62 ? 'sharp' : accuracy >= 55 ? 'reliable' : accuracy >= 48 ? 'neutral' : 'fade';
      await db.updateSourceAccuracy(source.id, parseFloat(accuracy), tier);
      console.log(`   ${source.name}: ${accuracy}% (${tier}) — ${rows[0].correct}/${rows[0].total}`);
    }
  }
}

// ═══ Run Full Outcome Evaluation ═══
export async function evaluateOutcomes() {
  console.log('\n═══════════════════════════════════════');
  console.log('  LumeLine Outcome Evaluation');
  console.log('═══════════════════════════════════════\n');

  const CORE_SPORTS = (process.env.CORE_SPORTS || 'basketball_ncaab').split(',');
  const SECONDARY_SPORTS = (process.env.SECONDARY_SPORTS || '').split(',').filter(s => s);
  const allSports = [...CORE_SPORTS, ...SECONDARY_SPORTS];
  
  let evaluated = 0;
  let wins = 0;
  let losses = 0;

  for (const sportKey of allSports) {
    const completedGames = await fetchScores(sportKey);
    if (!completedGames.length) continue;

    console.log(`   Found ${completedGames.length} completed games for ${SPORT_MAP[sportKey] || sportKey}`);

    for (const apiGame of completedGames) {
      const result = await evaluateGame(apiGame);
      if (result) {
        evaluated++;
        if (result.outcome === 'WIN') wins++;
        if (result.outcome === 'LOSS') losses++;
      }
    }
  }

  // Update aggregated stats
  if (evaluated > 0) {
    await updateAccuracyStats();
    await evaluateSourceAccuracy();
  }

  const summary = {
    evaluated,
    wins,
    losses,
    winRate: evaluated > 0 ? ((wins / evaluated) * 100).toFixed(1) + '%' : 'N/A'
  };

  console.log(`\n✦ Evaluation complete: ${evaluated} games — ${wins}W/${losses}L (${summary.winRate})\n`);
  return summary;
}

export default { evaluateOutcomes };
