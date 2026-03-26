import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

import db from './db.js';
import { runIngestion, runSecondaryIngestion, runFullIngestion } from './ingestion.js';
import { scoreAllSources, assignTier } from './scoring.js';
import { scanGame } from './anomaly.js';
import { generateConsensus, generateAllConsensus } from './consensus.js';
import { initTwilio, getTwilioStatus, sendConsensusAlert, sendAnomalyAlert, sendDailySummary } from './notifications.js';
import { evaluateOutcomes } from './outcomes.js';
import authRouter, { requireAuth, requirePlan, PLAN_PRICES, EARLY_BIRD_LIMIT } from './auth.js';
import agentRouter from './agent.js';
import { recordResult, getHouseReportCard, getFadeTargets, getSharpBooks, getHouseBias } from './house-accuracy.js';
import { recordOUResult, getOUTrends, getOUEdge, getOverMatchups, getUnderMatchups } from './over-under.js';
import { decodeGame, getSignals, getRecentSignals, scoreSignals, getDecoderAccuracy } from './house-decoder.js';
import betsRouter from './bets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Serve .well-known for TWA Digital Asset Links
app.use('/.well-known', express.static(path.join(__dirname, '..', '.well-known')));

// Auth routes
app.use('/api/auth', authRouter);

// Agent routes (OpenAI + ElevenLabs)
app.use('/api/agent', agentRouter);

// Bets / Betting Wallet routes (auth required)
app.use('/api/bets', requireAuth, betsRouter);


// ═══════════════════════════════════════════
//  HEALTH
// ═══════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '0.1.0',
    name: 'LumeLine',
    ecosystem: 'Trust Layer',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ═══════════════════════════════════════════
//  GAMES
// ═══════════════════════════════════════════
app.get('/api/games', async (req, res) => {
  try {
    const { sport } = req.query;
    const games = await db.getActiveGames(sport || null);
    res.json({ games, count: games.length });
  } catch (err) {
    console.error('GET /api/games error:', err);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

app.get('/api/games/:id', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Game not found' });
    
    const snapshots = await db.getSnapshotsForGame(req.params.id);
    const anomalies = await db.getAnomaliesForGame(req.params.id);
    
    res.json({ game: rows[0], snapshots, anomalies });
  } catch (err) {
    console.error('GET /api/games/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

// ═══════════════════════════════════════════
//  SOURCES
// ═══════════════════════════════════════════
app.get('/api/sources', async (req, res) => {
  try {
    const sources = await db.getSources();
    res.json({ sources, count: sources.length });
  } catch (err) {
    console.error('GET /api/sources error:', err);
    res.status(500).json({ error: 'Failed to fetch sources' });
  }
});

app.get('/api/sources/:slug', async (req, res) => {
  try {
    const source = await db.getSourceBySlug(req.params.slug);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    res.json(source);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch source' });
  }
});

// ═══════════════════════════════════════════
//  PICKS (External Sources)
// ═══════════════════════════════════════════
app.post('/api/picks', async (req, res) => {
  try {
    const { source_slug, game_id, market, pick_value, confidence } = req.body;
    
    if (!source_slug || !game_id || !pick_value) {
      return res.status(400).json({ error: 'source_slug, game_id, and pick_value are required' });
    }
    
    const source = await db.getSourceBySlug(source_slug);
    if (!source) return res.status(404).json({ error: `Source '${source_slug}' not found` });
    
    const pick = await db.submitPick({
      source_id: source.id,
      game_id,
      market: market || 'spread',
      pick_value,
      confidence: confidence || 50
    });
    
    console.log(`📥 Pick from ${source.name}: ${pick_value} on ${game_id}`);
    res.status(201).json(pick);
  } catch (err) {
    console.error('POST /api/picks error:', err);
    res.status(500).json({ error: 'Failed to submit pick' });
  }
});

// ═══════════════════════════════════════════
//  WIDGET (Embeddable data for partner sites)
// ═══════════════════════════════════════════
app.get('/api/widget', async (req, res) => {
  try {
    const games = await db.getActiveGames();
    const sources = await db.getSources();
    
    const widget = games.slice(0, 6).map(g => ({
      game_id: g.id,
      home_team: g.home_team,
      away_team: g.away_team,
      start_time: g.start_time,
      home_likelihood: g.home_likelihood || 50,
      away_likelihood: g.away_likelihood || 50,
      confidence: g.confidence || 0,
      integrity: g.integrity || 100,
      house_lean: g.house_lean || false
    }));
    
    res.json({
      games: widget,
      updated_at: new Date().toISOString(),
      branding: 'LumeLine · Trust Layer',
      source_count: sources.length
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate widget data' });
  }
});

// ═══════════════════════════════════════════
//  INGESTION TRIGGER (manual)
// ═══════════════════════════════════════════
app.post('/api/ingest', async (req, res) => {
  try {
    const mode = req.body?.mode || 'core';
    console.log(`🔄 Manual ingestion triggered (${mode})...`);
    let result;
    if (mode === 'full') {
      result = await runFullIngestion();
    } else if (mode === 'secondary') {
      result = await runSecondaryIngestion();
    } else {
      result = await runIngestion();
    }
    res.json({ status: 'complete', mode, ...result });
  } catch (err) {
    console.error('POST /api/ingest error:', err);
    res.status(500).json({ error: 'Ingestion failed', message: err.message });
  }
});

// ═══════════════════════════════════════════
//  ML PIPELINE (Score → Detect → Consensus)
// ═══════════════════════════════════════════
app.post('/api/pipeline', async (req, res) => {
  try {
    console.log('🧠 Running full ML pipeline...');
    const startTime = Date.now();

    // 1. Get all data
    const games = await db.getActiveGames();
    const sources = await db.getSources();
    const allAnomalies = [];
    const consensusList = [];

    // 2. For each game: detect anomalies → calculate integrity → generate consensus
    for (const game of games) {
      const snapshots = await db.getSnapshotsForGame(game.id);
      const scan = scanGame(game.id, snapshots, sources);

      // Store anomalies
      for (const anomaly of scan.anomalies) {
        try {
          await db.insertAnomaly(anomaly);
        } catch (e) { /* dupe ok */ }
      }
      allAnomalies.push(...scan.anomalies);

      // Generate consensus
      const gameWithIntegrity = { ...game, integrity_score: scan.integrity };
      const consensus = await generateConsensus(gameWithIntegrity, snapshots, sources, scan.anomalies);
      try {
        await db.insertConsensus(consensus);
      } catch (e) { /* ok */ }
      consensusList.push(consensus);
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Pipeline complete: ${games.length} games, ${allAnomalies.length} anomalies, ${consensusList.length} consensus in ${duration}ms`);

    res.json({
      status: 'complete',
      games: games.length,
      anomalies: allAnomalies.length,
      consensus: consensusList.length,
      duration_ms: duration
    });
  } catch (err) {
    console.error('POST /api/pipeline error:', err);
    res.status(500).json({ error: 'Pipeline failed', message: err.message });
  }
});

// ═══════════════════════════════════════════
//  ANOMALIES
// ═══════════════════════════════════════════
app.get('/api/anomalies', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM anomalies WHERE NOT resolved ORDER BY detected_at DESC LIMIT 50');
    res.json({ anomalies: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch anomalies' });
  }
});

// ═══════════════════════════════════════════
//  CONSENSUS
// ═══════════════════════════════════════════
app.get('/api/consensus', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM consensus ORDER BY generated_at DESC LIMIT 50');
    res.json({ predictions: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch consensus' });
  }
});

// P9: Consensus History & Trend Tracking
app.get('/api/consensus/:gameId/history', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT confidence, confidence_low, confidence_high, confidence_label,
              home_likelihood, away_likelihood, house_lean, reasoning, generated_at
       FROM consensus
       WHERE game_id = $1
       ORDER BY generated_at ASC`,
      [req.params.gameId]
    );

    const momentum = rows.length >= 2
      ? rows[rows.length - 1].confidence - rows[0].confidence
      : 0;

    const directionFlips = rows.slice(1).filter((r, i) => {
      const prev = rows[i];
      return (r.home_likelihood > 50) !== (prev.home_likelihood > 50);
    }).length;

    res.json({
      history: rows,
      momentum,
      direction_flips: directionFlips,
      is_stable: directionFlips === 0 && Math.abs(momentum) < 15,
      data_points: rows.length
    });
  } catch (err) {
    console.error('GET /api/consensus/:gameId/history error:', err);
    res.status(500).json({ error: 'Failed to fetch consensus history' });
  }
});

// P10: User ML Profile — Recalculate from bet history
app.post('/api/bets/recalculate-profile', requireAuth, async (req, res) => {
  try {
    const userId = req.body.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id required' });

    const { rows: bets } = await db.query(
      `SELECT ub.*, g.sport,
              (SELECT c.confidence FROM consensus c WHERE c.game_id = ub.game_id ORDER BY c.generated_at DESC LIMIT 1) AS consensus_confidence
       FROM user_bets ub
       LEFT JOIN games g ON ub.game_id = g.id
       WHERE ub.user_id = $1 AND ub.status IN ('won', 'lost', 'push')`,
      [userId]
    );

    if (!bets.length) return res.json({ profile: null, message: 'No settled bets found' });

    const winRate = (filterFn) => {
      const filtered = bets.filter(filterFn);
      if (!filtered.length) return 0;
      const wins = filtered.filter(b => b.status === 'won').length;
      return Math.round((wins / filtered.length) * 100 * 10) / 10;
    };

    const calcROI = (subset) => {
      const totalStake = subset.reduce((s, b) => s + parseFloat(b.stake || 0), 0);
      if (!totalStake) return 0;
      const totalReturn = subset
        .filter(b => b.status === 'won')
        .reduce((s, b) => s + parseFloat(b.result_amount || b.potential_win || 0), 0);
      return Math.round(((totalReturn - totalStake) / totalStake) * 100 * 10) / 10;
    };

    const profile = {
      wr_spread: winRate(b => b.bet_type === 'spread'),
      wr_moneyline: winRate(b => b.bet_type === 'moneyline'),
      wr_total: winRate(b => b.bet_type === 'total'),
      wr_parlay: winRate(b => b.parlay_type != null),
      wr_prop: winRate(b => b.bet_type === 'prop'),
      wr_nfl: winRate(b => b.sport?.toLowerCase() === 'nfl'),
      wr_nba: winRate(b => b.sport?.toLowerCase() === 'nba'),
      wr_mlb: winRate(b => b.sport?.toLowerCase() === 'mlb'),
      wr_nhl: winRate(b => b.sport?.toLowerCase() === 'nhl'),
      roi_high_confidence: calcROI(bets.filter(b => (b.consensus_confidence || 0) > 70)),
      roi_medium_confidence: calcROI(bets.filter(b => (b.consensus_confidence || 0) >= 50 && (b.consensus_confidence || 0) <= 70)),
      roi_low_confidence: calcROI(bets.filter(b => (b.consensus_confidence || 0) < 50)),
      total_settled_bets: bets.length,
      last_calculated: new Date(),
    };

    // Find best book
    const bookMap = {};
    bets.forEach(b => {
      if (!b.sportsbook) return;
      if (!bookMap[b.sportsbook]) bookMap[b.sportsbook] = { won: 0, total: 0 };
      bookMap[b.sportsbook].total++;
      if (b.status === 'won') bookMap[b.sportsbook].won++;
    });
    const bestBook = Object.entries(bookMap).sort((a, b) => (b[1].won / b[1].total) - (a[1].won / a[1].total))[0];
    if (bestBook) profile.best_book_slug = bestBook[0];

    await db.query(
      `INSERT INTO user_ml_profile (user_id, ${Object.keys(profile).join(', ')})
       VALUES ($1, ${Object.keys(profile).map((_, i) => '$' + (i + 2)).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${Object.keys(profile).map(k => `${k} = EXCLUDED.${k}`).join(', ')}`,
      [userId, ...Object.values(profile)]
    );

    res.json({ profile });
  } catch (err) {
    console.error('POST /api/bets/recalculate-profile error:', err);
    res.status(500).json({ error: 'Profile recalculation failed', message: err.message });
  }
});

// P10: Get user ML profile
app.get('/api/users/:userId/ml-profile', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM user_ml_profile WHERE user_id = $1', [req.params.userId]);
    if (!rows.length) return res.json({ profile: null, message: 'No profile yet — needs 10+ settled bets' });

    const profile = rows[0];
    const notes = [];

    if (profile.total_settled_bets >= 10) {
      if (profile.wr_parlay < 40 && profile.wr_parlay > 0)
        notes.push(`Your parlay win rate is ${profile.wr_parlay}% — consider straight bets`);
      if (profile.roi_high_confidence > 5)
        notes.push(`Strong track record on high-confidence picks (+${profile.roi_high_confidence}% ROI)`);
      if (profile.wr_nba > 58)
        notes.push(`You're sharp on NBA (${profile.wr_nba}% win rate)`);
      if (profile.wr_nfl < 45 && profile.wr_nfl > 0)
        notes.push(`NFL has been tough for you (${profile.wr_nfl}%) — consider smaller stakes`);
      if (profile.best_book_slug)
        notes.push(`Your best book: ${profile.best_book_slug}`);
    }

    res.json({ profile, personalized_notes: notes });
  } catch (err) {
    console.error('GET /api/users/:userId/ml-profile error:', err);
    res.status(500).json({ error: 'Failed to fetch ML profile' });
  }
});

// ═══════════════════════════════════════════
//  OUTCOME EVALUATION & ACCURACY
// ═══════════════════════════════════════════
app.post('/api/outcomes/evaluate', async (req, res) => {
  try {
    console.log('🏆 Manual outcome evaluation triggered...');
    const result = await evaluateOutcomes();
    res.json({ status: 'complete', ...result });
  } catch (err) {
    console.error('POST /api/outcomes/evaluate error:', err);
    res.status(500).json({ error: 'Evaluation failed', message: err.message });
  }
});

app.get('/api/accuracy', async (req, res) => {
  try {
    let rows = [];
    let recent = [];
    try {
      const result = await db.query(`
        SELECT * FROM accuracy_stats 
        WHERE confidence_bucket IS NULL 
        ORDER BY 
          CASE window WHEN 'all' THEN 0 WHEN '7d' THEN 1 WHEN '30d' THEN 2 WHEN '90d' THEN 3 END,
          sport NULLS FIRST
      `);
      rows = result.rows;
    } catch (e) {
      // Table may not exist yet — graceful fallback
      console.warn('accuracy_stats table not found, returning empty stats');
    }
    
    try {
      const result = await db.query(`
        SELECT co.*, g.home_team, g.away_team, g.sport, go.home_score, go.away_score
        FROM consensus_outcomes co
        JOIN games g ON g.id = co.game_id
        LEFT JOIN game_outcomes go ON go.game_id = co.game_id
        ORDER BY co.evaluated_at DESC LIMIT 20
      `);
      recent = result.rows;
    } catch (e) {
      // Table may not exist yet
      console.warn('consensus_outcomes table not found, returning empty recent');
    }
    
    res.json({ stats: rows, recent, count: rows.length });
  } catch (err) {
    console.error('GET /api/accuracy error:', err);
    res.status(500).json({ error: 'Failed to fetch accuracy' });
  }
});

app.get('/api/accuracy/:sport', async (req, res) => {
  try {
    const sport = req.params.sport.toUpperCase();
    const { rows } = await db.query(
      'SELECT * FROM accuracy_stats WHERE sport = $1 ORDER BY window', [sport]
    );
    const { rows: outcomes } = await db.query(`
      SELECT co.*, g.home_team, g.away_team, go.home_score, go.away_score
      FROM consensus_outcomes co
      JOIN games g ON g.id = co.game_id
      LEFT JOIN game_outcomes go ON go.game_id = co.game_id
      WHERE co.sport = $1
      ORDER BY co.evaluated_at DESC LIMIT 20
    `, [sport]);
    res.json({ stats: rows, outcomes, sport });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sport accuracy' });
  }
});

// ═══════════════════════════════════════════
//  TWILIO NOTIFICATIONS
// ═══════════════════════════════════════════
app.get('/api/notifications/status', (req, res) => {
  res.json(getTwilioStatus());
});

app.post('/api/notifications/consensus', async (req, res) => {
  try {
    const { phone, game_id } = req.body;
    if (!phone || !game_id) return res.status(400).json({ error: 'phone and game_id required' });

    const { rows } = await db.query('SELECT * FROM games WHERE id = $1', [game_id]);
    if (!rows.length) return res.status(404).json({ error: 'Game not found' });

    const games = await db.getActiveGames();
    const game = games.find(g => g.id === game_id) || rows[0];

    const consensus = game.confidence != null ? game : {
      home_likelihood: game.home_likelihood || 50,
      away_likelihood: game.away_likelihood || 50,
      confidence: game.confidence || 0,
      integrity: game.integrity || 100,
      house_lean: game.house_lean || false,
      reasoning: game.reasoning || 'No analysis available'
    };

    const result = await sendConsensusAlert(phone, game, consensus);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to send alert', message: err.message });
  }
});

app.post('/api/notifications/daily', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const games = await db.getActiveGames();
    const sources = await db.getSources();
    const { rows: anomalies } = await db.query('SELECT COUNT(*) FROM anomalies WHERE NOT resolved');

    const topSource = sources[0] || { name: 'N/A', accuracy_30d: 0 };
    const highConf = games.filter(g => g.confidence >= 70);

    const result = await sendDailySummary(phone, {
      gameCount: games.length,
      topSource: topSource.name,
      topAccuracy: topSource.accuracy_30d,
      anomalyCount: parseInt(anomalies[0]?.count || 0),
      highConfCount: highConf.length
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to send summary', message: err.message });
  }
});

// ═══════════════════════════════════════════
//  HOUSE DECODER
// ═══════════════════════════════════════════

// House accuracy report card
app.get('/api/decoder/house-accuracy', requireAuth, requirePlan('house_decoder'), async (req, res) => {
  try {
    const { market, sport, period } = req.query;
    const report = await getHouseReportCard(market || 'spread', sport || null, period || '30d');
    const fades = await getFadeTargets(market || 'spread', period || '30d');
    const sharps = await getSharpBooks(market || 'spread', period || '30d');
    res.json({ report, fade_targets: fades, follow_targets: sharps });
  } catch (err) {
    console.error('GET /api/decoder/house-accuracy error:', err);
    res.status(500).json({ error: 'Failed to fetch house accuracy' });
  }
});

// House bias for a specific source
app.get('/api/decoder/bias/:slug', requireAuth, requirePlan('house_decoder'), async (req, res) => {
  try {
    const { sport } = req.query;
    const bias = await getHouseBias(req.params.slug, sport || null);
    if (!bias) return res.status(404).json({ error: 'No accuracy data for this source' });
    res.json(bias);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bias data' });
  }
});

// Over/Under trends
app.get('/api/decoder/ou-trends', requireAuth, requirePlan('house_decoder'), async (req, res) => {
  try {
    const { sport } = req.query;
    const trends = await getOUTrends(sport || null);
    const edge = await getOUEdge(sport || null);
    const overMatchups = await getOverMatchups(sport || null);
    const underMatchups = await getUnderMatchups(sport || null);
    res.json({ trends, edge_matchups: edge, always_over: overMatchups, always_under: underMatchups });
  } catch (err) {
    console.error('GET /api/decoder/ou-trends error:', err);
    res.status(500).json({ error: 'Failed to fetch O/U trends' });
  }
});

// Decoder signals for a specific game
app.get('/api/decoder/signals/:gameId', requireAuth, requirePlan('house_decoder'), async (req, res) => {
  try {
    const signals = await getSignals(req.params.gameId);
    res.json({ signals, count: signals.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

// All recent decoder signals
app.get('/api/decoder/signals', requireAuth, requirePlan('house_decoder'), async (req, res) => {
  try {
    const { limit } = req.query;
    const signals = await getRecentSignals(parseInt(limit) || 20);
    res.json({ signals, count: signals.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch recent signals' });
  }
});

// Run decoder on a game
app.post('/api/decoder/decode/:gameId', requireAuth, requirePlan('house_decoder'), async (req, res) => {
  try {
    const signals = await decodeGame(req.params.gameId);
    res.json({ signals, count: signals.length });
  } catch (err) {
    console.error('POST /api/decoder/decode error:', err);
    res.status(500).json({ error: 'Decode failed', message: err.message });
  }
});

// Record game result + score all books
app.post('/api/decoder/result', requireAuth, requirePlan('house_decoder'), async (req, res) => {
  try {
    const { game_id, home_score, away_score } = req.body;
    if (!game_id || home_score == null || away_score == null) {
      return res.status(400).json({ error: 'game_id, home_score, and away_score are required' });
    }
    const result = await recordResult(game_id, home_score, away_score);
    const ouResult = await recordOUResult(game_id);
    const signalScores = await scoreSignals();
    res.json({ result, ou_analysis: ouResult, signals_scored: signalScores.scored });
  } catch (err) {
    console.error('POST /api/decoder/result error:', err);
    res.status(500).json({ error: 'Result recording failed', message: err.message });
  }
});

// Decoder accuracy (how well is the decoder performing?)
app.get('/api/decoder/accuracy', requireAuth, requirePlan('house_decoder'), async (req, res) => {
  try {
    const accuracy = await getDecoderAccuracy();
    res.json({ signal_accuracy: accuracy });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch decoder accuracy' });
  }
});

// Free preview teaser (no auth required — drives conversion)
app.get('/api/decoder/preview', async (req, res) => {
  try {
    const signals = await getRecentSignals(5);
    // Return counts and types only — no predictions or details
    const teaser = {
      active_signals: signals.length,
      signal_types: [...new Set(signals.map(s => s.signal_type))],
      games_decoded: [...new Set(signals.map(s => s.game_id))].length,
      sample: signals.slice(0, 2).map(s => ({
        signal_type: s.signal_type,
        sport: s.sport,
        matchup: `${s.away_team} @ ${s.home_team}`,
        confidence: '🔒',
        prediction: '🔒 Upgrade to unlock',
        description: s.description?.slice(0, 40) + '... 🔒'
      })),
      unlock: {
        plan: 'house_decoder',
        name: 'House Decoder',
        early_bird: '$14.99/mo',
        standard: '$29.99/mo',
        features: ['House accuracy scoring', 'O/U edge detection', '5 signal detectors', 'Self-learning predictions', 'Full signal details']
      }
    };
    res.json(teaser);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

// Subscription plans info (public)
app.get('/api/plans', (req, res) => {
  res.json({
    plans: Object.entries(PLAN_PRICES).map(([key, val]) => ({
      id: key,
      name: val.name,
      early_bird: `$${(val.early / 100).toFixed(2)}/mo`,
      standard: `$${(val.standard / 100).toFixed(2)}/mo`,
      early_bird_cents: val.early,
      standard_cents: val.standard
    })),
    early_bird_limit: EARLY_BIRD_LIMIT,
    note: `First ${EARLY_BIRD_LIMIT} subscribers on each plan get early bird pricing locked in for life.`
  });
});

// ═══════════════════════════════════════════
//  ADMIN ENDPOINTS
// ═══════════════════════════════════════════
app.get('/api/admin/users', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT u.*, (SELECT COUNT(*) FROM user_picks WHERE user_id = u.id) as pick_count
      FROM users u ORDER BY u.created_at DESC
    `);
    res.json({ users: rows, count: rows.length });
  } catch (err) {
    res.json({ users: [], count: 0 });
  }
});

app.get('/api/admin/env', (req, res) => {
  res.json({
    DATABASE_URL: !!process.env.DATABASE_URL,
    ODDS_API_KEY: !!process.env.ODDS_API_KEY && process.env.ODDS_API_KEY !== 'your_key_here',
    TWILIO: !!process.env.TWILIO_ACCOUNT_SID,
    RESEND: !!process.env.RESEND_API_KEY,
    STRIPE: !!process.env.STRIPE_SECRET_KEY,
    JWT: !!process.env.JWT_SECRET
  });
});

// ═══════════════════════════════════════════
//  STRIPE CHECKOUT
// ═══════════════════════════════════════════
app.post('/api/stripe/checkout', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }
    const stripe = (await import('stripe')).default(process.env.STRIPE_SECRET_KEY);
    const { plan, user_id } = req.body;

    // Three independent products
    const plans = {
      game_predictions: { name: 'LumeLine Game Predictions', description: 'Full consensus predictions, all 47 sources, anomaly alerts, push notifications', early: 999, standard: 1999 },
      house_decoder:    { name: 'LumeLine House Decoder', description: 'House accuracy scoring, O/U edge detection, 5 signal detectors, self-learning predictions', early: 1499, standard: 2999 },
      all_access:       { name: 'LumeLine All-Access', description: 'Game Predictions + House Decoder — everything LumeLine offers', early: 1999, standard: 3999 }
    };

    const p = plans[plan];
    if (!p) return res.status(400).json({ error: 'Invalid plan. Choose: game_predictions, house_decoder, or all_access' });

    // Check subscriber count for early bird pricing
    let subscriberCount = 0;
    try {
      const { rows } = await db.query(
        "SELECT COUNT(*) FROM users WHERE preferences->>'plan' IS NOT NULL OR preferences->'plans' IS NOT NULL"
      );
      subscriberCount = parseInt(rows[0]?.count || 0);
    } catch (e) { /* table may not exist yet */ }

    const amount = subscriberCount < EARLY_BIRD_LIMIT ? p.early : p.standard;
    const priceLabel = subscriberCount < EARLY_BIRD_LIMIT ? '(Early Bird)' : '';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { 
            name: `${p.name} ${priceLabel}`.trim(), 
            description: p.description 
          },
          recurring: { interval: 'month' },
          unit_amount: amount
        },
        quantity: 1
      }],
      success_url: `${req.protocol}://${req.get('host')}/dashboard.html?upgrade=success&plan=${plan}`,
      cancel_url: `${req.protocol}://${req.get('host')}/dashboard.html?upgrade=cancel`,
      metadata: { user_id: user_id || '', plan, early_bird: subscriberCount < EARLY_BIRD_LIMIT ? 'true' : 'false' }
    });

    res.json({ url: session.url, session_id: session.id, plan, amount_cents: amount, early_bird: subscriberCount < EARLY_BIRD_LIMIT });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Checkout failed', message: err.message });
  }
});

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }
    const stripe = (await import('stripe')).default(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        const plan = session.metadata?.plan;
        const isEarlyBird = session.metadata?.early_bird === 'true';
        if (userId && plan) {
          // Store the plan — support multiple independent plans
          const { rows: userRows } = await db.query('SELECT preferences FROM users WHERE id = $1', [userId]);
          const prefs = userRows[0]?.preferences || {};
          const existingPlans = Array.isArray(prefs.plans) ? prefs.plans : (prefs.plan ? [prefs.plan] : []);
          
          // If all_access, replace everything. Otherwise add the plan.
          const newPlans = plan === 'all_access' 
            ? ['all_access'] 
            : [...new Set([...existingPlans, plan])];
          
          const updatedPrefs = {
            ...prefs,
            plan: newPlans.includes('all_access') ? 'all_access' : newPlans[0],
            plans: newPlans,
            early_bird: isEarlyBird,
            stripe_customer_id: session.customer,
            [`stripe_sub_${plan}`]: session.subscription
          };
          
          await db.query(
            "UPDATE users SET preferences = $1 WHERE id = $2",
            [JSON.stringify(updatedPrefs), userId]
          );
          console.log(`💳 User ${userId} subscribed to ${plan}${isEarlyBird ? ' (Early Bird 🐦)' : ''}`);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await db.query(
          "UPDATE users SET preferences = preferences - 'plan' - 'stripe_subscription_id' WHERE preferences->>'stripe_subscription_id' = $1",
          [sub.id]
        );
        console.log(`💳 Subscription cancelled: ${sub.id}`);
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err);
    res.status(400).json({ error: 'Webhook failed' });
  }
});

app.get('/api/stripe/status', (req, res) => {
  res.json({
    configured: !!process.env.STRIPE_SECRET_KEY,
    publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null
  });
});

// ═══════════════════════════════════════════
//  STRIPE CONNECT (Partner Payouts)
// ═══════════════════════════════════════════
// Partners onboard via Stripe Connect Express — banking details are handled
// entirely by Stripe's hosted form. Payouts flow: Platform → Orbit Staffing → Partner.

let partnerConnectId = null; // In prod, stored in DB per partner

app.post('/api/partner/connect', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }
    const stripe = (await import('stripe')).default(process.env.STRIPE_SECRET_KEY);
    const { partner_name, partner_email } = req.body;

    // Check if already created
    if (partnerConnectId) {
      const accountLink = await stripe.accountLinks.create({
        account: partnerConnectId,
        refresh_url: `${req.protocol}://${req.get('host')}/partner-onboarding.html`,
        return_url: `${req.protocol}://${req.get('host')}/api/partner/connect/return`,
        type: 'account_onboarding'
      });
      return res.json({ url: accountLink.url, account_id: partnerConnectId });
    }

    // Create Express connected account for partner
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: partner_email || undefined,
      business_type: 'individual',
      individual: { first_name: 'King', last_name: 'Capper' },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { partner: 'king_capper', ecosystem: 'trust_layer', platform: 'orbit_staffing' }
    });

    partnerConnectId = account.id;
    console.log(`💳 Partner Connect account created: ${account.id}`);

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${req.protocol}://${req.get('host')}/partner-onboarding.html`,
      return_url: `${req.protocol}://${req.get('host')}/api/partner/connect/return`,
      type: 'account_onboarding'
    });

    res.json({ url: accountLink.url, account_id: account.id });
  } catch (err) {
    console.error('Partner connect error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/partner/connect/return', (req, res) => {
  // Stripe redirects here after partner completes banking setup
  res.redirect('/partner-onboarding.html#slide=7');
});

app.get('/api/partner/connect/status', async (req, res) => {
  try {
    if (!partnerConnectId || !process.env.STRIPE_SECRET_KEY) {
      return res.json({ linked: false });
    }
    const stripe = (await import('stripe')).default(process.env.STRIPE_SECRET_KEY);
    const account = await stripe.accounts.retrieve(partnerConnectId);
    res.json({
      linked: account.charges_enabled && account.payouts_enabled,
      details_submitted: account.details_submitted,
      account_id: partnerConnectId
    });
  } catch (err) {
    res.json({ linked: false, error: err.message });
  }
});

app.post('/api/partner/payout', async (req, res) => {
  try {
    if (!partnerConnectId || !process.env.STRIPE_SECRET_KEY) {
      return res.status(400).json({ error: 'Partner account not linked' });
    }
    const stripe = (await import('stripe')).default(process.env.STRIPE_SECRET_KEY);
    const { amount_cents, description } = req.body;

    // Create transfer from platform to partner's connected account
    const transfer = await stripe.transfers.create({
      amount: amount_cents || 0,
      currency: 'usd',
      destination: partnerConnectId,
      description: description || 'LumeLine Partner Payout — Orbit Staffing',
      metadata: { partner: 'king_capper', via: 'orbit_staffing' }
    });

    console.log(`💰 Partner payout: $${(amount_cents / 100).toFixed(2)} → ${partnerConnectId}`);
    res.json({ success: true, transfer_id: transfer.id });
  } catch (err) {
    console.error('Payout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
//  SCHEDULED INGESTION (Tiered)
// ═══════════════════════════════════════════
// BETA: Core sports only (NBA, NHL, NCAAB)
// Core: 3 sports × 144 = 432 req/day + outcomes 36 = 468/day (under 500 free tier)
const CORE_INTERVAL = 10 * 60 * 1000;      // 10 minutes — max frequency for free tier
const SECONDARY_INTERVAL = 60 * 60 * 1000; // 60 minutes (inactive)

function startScheduler() {
  console.log('⏰ Scheduler [BETA — Max Frequency]:');
  console.log('   NBA, NHL, NCAAB → every 10 min (~468 req/day)');
  console.log('   Secondary → disabled (coming soon)');
  console.log('   Outcome evaluation → every 2 hours');

  // Core sports scheduler
  setInterval(async () => {
    try {
      await runIngestion();
    } catch (err) {
      console.error('Scheduled core ingestion error:', err.message);
    }
  }, CORE_INTERVAL);

  // Secondary sports scheduler  
  setInterval(async () => {
    try {
      await runSecondaryIngestion();
    } catch (err) {
      console.error('Scheduled secondary ingestion error:', err.message);
    }
  }, SECONDARY_INTERVAL);

  // Outcome evaluation — every 2 hours
  const OUTCOME_INTERVAL = 2 * 60 * 60 * 1000;
  const runOutcomes = async () => {
    try {
      console.log('🔄 Running scheduled outcome evaluation...');
      await evaluateOutcomes();
    } catch (err) {
      console.error('❌ Scheduled outcome evaluation error:', err.message);
    }
  };

  // Enforce strict interval and trigger initial run after boot
  setTimeout(runOutcomes, 5000);
  setInterval(runOutcomes, OUTCOME_INTERVAL);
}

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║                                           ║');
  console.log('║    ◆ LumeLine Server v0.2.0               ║');
  console.log('║    Odds Intelligence · Trust Layer         ║');
  console.log('║                                           ║');
  console.log('╠═══════════════════════════════════════════╣');
  console.log(`║  🌐 Dashboard:  http://localhost:${PORT}       ║`);
  console.log(`║  🔌 API:        http://localhost:${PORT}/api   ║`);
  console.log(`║  📡 Widget:     http://localhost:${PORT}/api/widget ║`);
  console.log(`║  ❤️  Health:     http://localhost:${PORT}/api/health ║`);
  console.log('║                                           ║');
  console.log('║  Built with Lume · DarkWave Studios        ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');
  
  if (process.env.ODDS_API_KEY && process.env.ODDS_API_KEY !== 'your_key_here') {
    startScheduler();
    // Initial boot: ingest core immediately, secondary after 5 sec
    runIngestion().catch(err => console.error('Initial core ingestion error:', err.message));
    setTimeout(() => {
      runSecondaryIngestion().catch(err => console.error('Initial secondary ingestion error:', err.message));
    }, 5000);
  } else {
    console.log('⚠️  No ODDS_API_KEY set — running in demo mode');
    console.log('   Set ODDS_API_KEY in .env to enable live data');
  }

  // Initialize Twilio
  initTwilio();
});
