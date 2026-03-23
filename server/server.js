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
import authRouter, { requireAuth } from './auth.js';
import agentRouter from './agent.js';

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

// One-time migration: rename Mathew → King Capper
db.query(`UPDATE sources SET name = 'King Capper', slug = 'king-capper' WHERE slug = 'mathew'`)
  .then(r => { if (r.rowCount) console.log('✅ Renamed Mathew → King Capper'); })
  .catch(() => {});

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

    const prices = {
      pro: { amount: 999, name: 'LumeLine Pro', interval: 'month' }
    };
    const p = prices[plan];
    if (!p) return res.status(400).json({ error: 'Invalid plan' });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: p.name, description: 'Real-time alerts, advanced anomaly reports, historical data, API access' },
          recurring: { interval: p.interval },
          unit_amount: p.amount
        },
        quantity: 1
      }],
      success_url: `${req.protocol}://${req.get('host')}/dashboard.html?upgrade=success`,
      cancel_url: `${req.protocol}://${req.get('host')}/dashboard.html?upgrade=cancel`,
      metadata: { user_id: user_id || '', plan }
    });

    res.json({ url: session.url, session_id: session.id });
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
        if (userId) {
          await db.query(
            "UPDATE users SET preferences = preferences || $1 WHERE id = $2",
            [JSON.stringify({ plan: 'pro', stripe_customer_id: session.customer, stripe_subscription_id: session.subscription }), userId]
          );
          console.log(`💳 User ${userId} upgraded to Pro`);
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
  setInterval(async () => {
    try {
      await evaluateOutcomes();
    } catch (err) {
      console.error('Scheduled outcome evaluation error:', err.message);
    }
  }, 2 * 60 * 60 * 1000);
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
