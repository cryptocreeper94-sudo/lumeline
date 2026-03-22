import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

import db from './db.js';
import { runIngestion } from './ingestion.js';
import { scoreAllSources, assignTier } from './scoring.js';
import { scanGame } from './anomaly.js';
import { generateConsensus, generateAllConsensus } from './consensus.js';
import { initTwilio, getTwilioStatus, sendConsensusAlert, sendAnomalyAlert, sendDailySummary } from './notifications.js';
import authRouter, { requireAuth } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Auth routes
app.use('/api/auth', authRouter);

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
    console.log('🔄 Manual ingestion triggered...');
    const result = await runIngestion();
    res.json({ status: 'complete', ...result });
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
      const consensus = generateConsensus(gameWithIntegrity, snapshots, sources, scan.anomalies);
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
//  SCHEDULED INGESTION
// ═══════════════════════════════════════════
const INTERVAL = (parseInt(process.env.INGESTION_INTERVAL_MINUTES) || 15) * 60 * 1000;

function startScheduler() {
  console.log(`⏰ Scheduler: ingestion every ${INTERVAL / 60000} minutes`);
  setInterval(async () => {
    try {
      await runIngestion();
    } catch (err) {
      console.error('Scheduled ingestion error:', err.message);
    }
  }, INTERVAL);
}

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║                                           ║');
  console.log('║    ◆ LumeLine Server v0.1.0               ║');
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
    runIngestion().catch(err => console.error('Initial ingestion error:', err.message));
  } else {
    console.log('⚠️  No ODDS_API_KEY set — running in demo mode');
    console.log('   Set ODDS_API_KEY in .env to enable live data');
  }

  // Initialize Twilio
  initTwilio();
});
