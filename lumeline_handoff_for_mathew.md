# LumeLine — Technical Integration Brief for Mathew
### Prepared by DarkWave Studios · Trust Layer Ecosystem
### Revision 2.0 · March 2026

---

> **TL;DR:** Jason's building a real-time odds intelligence engine that tracks every bookmaker, detects when they're colluding, and uses ML to tell you who's lying. Mathew's picks are already ranked #1 in the system. Here's how to connect your site to it.

---

## 1. What LumeLine Actually Does

LumeLine treats every oddsmaker as a **signal source** — not a place to bet, but a data point to analyze. It runs a continuous intelligence pipeline:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  47 Books   │────▶│  Snapshot    │────▶│  Anomaly    │────▶│  Consensus  │
│  Polled     │     │  Engine      │     │  Detector   │     │  Engine     │
│  Every 15m  │     │  3 Markets   │     │  5 Signals  │     │  ML + GPT-4 │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │                    │
       ▼                   ▼                   ▼                    ▼
   Odds API         PostgreSQL          Integrity Score      Weighted Vote
   ESPN/API-FB      Time-Series         Collusion Flags      House Lean Bias
                    Line Movements      Reverse Steam        AI Reasoning
```

### The Engine Breakdown

| Module | What It Does | Lines of Code |
|--------|-------------|---------------|
| `ingestion.js` | Polls The Odds API for spreads, moneylines, totals across NFL + NBA. Captures every line movement with millisecond timestamps. Logs API quota usage. | 142 |
| `scoring.lume` | Calculates source accuracy (hit rate, CLV, consistency, timing). Auto-tiers sources as Sharp → Reliable → Neutral → Fade based on 30-day performance windows. | 180 |
| `anomaly.lume` | Runs 5 detection algorithms: synchronized moves, reverse steam traps, house divergence, late flips, outlier consensus. Each anomaly penalizes the game's integrity score. | 168 |
| `consensus.lume` | Weighted ensemble — Sharp sources get 2.5x weight, Fade sources get 0.3x. Uses `ask gpt4` for natural language analysis. When confidence < 60%, system defers to house line. | 145 |
| `db.js` | Neon Serverless PostgreSQL with 7 tables, 4 enum types, 12 composite indexes, 2 materialized views for real-time leaderboard and active games. | 108 |
| `server.js` | Express REST API with 8 endpoints, CORS, scheduled ingestion (cron), widget data endpoint for partner embedding, health monitoring. | 168 |
| `dashboard.lume` | Full premium UI built in Lume — glass-card glassmorphism, floating orb animations, 3-column bento grid, game card carousel, source leaderboard, pattern feed, AI insight panel. | 320 |
| `schema.sql` | PostgreSQL schema with UUID primary keys, JSONB metadata columns, cascade deletes, check constraints, trigram indexes for fuzzy search. | 156 |

**Total: ~1,400 lines across 12 files. Built in 2 hours.**

---

## 2. Mathew's Current Standing

Mathew's picks are fed into the system as an **external source**. His current stats:

| Metric | Value | Rank |
|--------|-------|------|
| **Accuracy (30d)** | 71% | **#1 overall** |
| **Last 10** | 8-2 | Streak |
| **Tier** | ⭐ **Sharp** | Auto-promoted |
| **Weight Multiplier** | 2.5x | Highest tier |
| **Total Picks** | 124 | Growing |

The system auto-promoted Mathew to Sharp tier based on his 71% hit rate — higher than Pinnacle (68%) and Circa (64%). His picks carry the heaviest weight in consensus calculations.

---

## 3. Integration Options

### Option A: Widget Embed (Easy)
Drop a `<script>` tag and LumeLine renders a mini-dashboard on your site.

```html
<!-- LumeLine Widget -->
<div id="lumeline-widget"></div>
<script src="https://lumeline.dwtl.io/widget.js" 
        data-source="mathew" 
        data-theme="dark"
        data-games="6"></script>
```

### Option B: REST API (Full Control)

```
Base URL: https://lumeline.dwtl.io/api

GET  /api/games              → All active games with consensus
GET  /api/games/:id          → Full game breakdown (snapshots, anomalies)
GET  /api/sources             → Source leaderboard
GET  /api/sources/:slug       → Individual source profile
POST /api/picks               → Submit a pick
GET  /api/widget              → Pre-formatted widget data
GET  /api/health              → System health
POST /api/ingest              → Trigger manual ingestion
```

**Submit a pick:**
```json
POST /api/picks
{
  "source_slug": "mathew",
  "game_id": "uuid-of-game",
  "market": "spread",
  "pick_value": "KC -3.5",
  "confidence": 85
}
```

**Response:**
```json
{
  "id": "pick_uuid",
  "source_id": "mathew_uuid",
  "game_id": "game_uuid",
  "pick_value": "KC -3.5",
  "confidence": 85,
  "result": null,
  "submitted_at": "2026-03-22T18:00:00Z"
}
```

---

## 4. Push Notifications (for Mathew's Customers)

We recommend combining **Twilio** (SMS/push) + **Resend** (email) for a full notification stack.

### Twilio Setup (SMS Alerts)
```bash
npm install twilio
```
```javascript
import twilio from 'twilio';
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

// Send alert when LumeLine flags a high-confidence consensus
async function sendAlert(phone, game, consensus) {
  await client.messages.create({
    body: `🎯 LumeLine Alert: ${game.away_team} @ ${game.home_team} — ` +
          `${consensus.confidence}% confidence, ${consensus.integrity}/100 integrity. ` +
          `${consensus.house_lean ? '🏠 House Lean Active' : '✅ Clean'}`,
    from: process.env.TWILIO_PHONE,
    to: phone
  });
}
```

### Resend Setup (Styled Email)
```bash
npm install resend
```
```javascript
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendDailyBrief(email, games, topSource) {
  await resend.emails.send({
    from: 'LumeLine <alerts@lumeline.dwtl.io>',
    to: email,
    subject: `📊 Daily Brief — ${games.length} games, ${topSource.name} leads at ${topSource.accuracy_30d}%`,
    html: buildEmailTemplate(games, topSource)  // Premium HTML email
  });
}
```

### Recommended Architecture
```
LumeLine Consensus Engine
         │
         ├── High Confidence (≥70%) ──▶ Twilio SMS ──▶ Mathew's Customers
         ├── Anomaly Alert ──────────▶ Twilio SMS ──▶ Mathew's Customers
         └── Daily Summary ──────────▶ Resend Email ──▶ Full breakdown
```

**Environment Variables Needed:**
```bash
TWILIO_SID=ACxxxxxxxxxx
TWILIO_AUTH=your_auth_token
TWILIO_PHONE=+1234567890
RESEND_API_KEY=re_xxxxxxxxxx
```

---

## 5. DarkWave Design System (Ultra-Premium UI)

Our canonical design language — **DarkWave** — is what makes everything look like it costs $50K to build. Here's the system:

### Color Palette
```css
--bg-primary:      #030712    /* Deep space black */
--bg-card:         rgba(12, 18, 36, 0.65)  /* Glass */
--accent-cyan:     #67e8f9    /* Primary accent */
--accent-emerald:  #6ee7b7    /* Success */
--accent-amber:    #fbbf24    /* Warning */
--accent-red:      #fca5a5    /* Danger */
--accent-purple:   #a78bfa    /* AI/ML elements */
--text-primary:    #ffffff
--text-secondary:  rgba(255, 255, 255, 0.4)
--text-muted:      rgba(255, 255, 255, 0.15)
```

### Glass Cards
```css
.glass-card {
  background: rgba(12, 18, 36, 0.65);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0.75rem;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.glass-card:hover {
  transform: scale(1.02) translateY(-2px);
  border-color: rgba(255, 255, 255, 0.12);
}
```

### Floating Orbs (Background Ambience)
Fixed-position blurred circles with slow animations:
```css
.orb {
  position: fixed;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.04;
  pointer-events: none;
  animation: float 12s ease-in-out infinite;
}
```

### Gradient Text
```css
.gradient-text {
  background: linear-gradient(135deg, #f0f9ff, #67e8f9, #f0f9ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

### Canonical Layout
- **3-column bento grid** on desktop (280px | 1fr | 300px)
- **Responsive collapse** to single column on mobile
- **Reveal-on-scroll** animations with staggered delays
- **Google Fonts: Inter** (weights 300–900)
- **Micro-animations**: pulse dots, shimmer effects, hover transforms

---

## 6. Architecture Summary

```
              ┌─────────────────────────────────────────┐
              │          LumeLine Platform               │
              │         Trust Layer Ecosystem            │
              ├─────────────────────────────────────────┤
              │                                         │
              │   ┌──────────┐    ┌──────────────────┐ │
              │   │  Lume    │    │   Express API    │ │
              │   │  Source  │───▶│   server.js      │ │
              │   │  Files   │    │   8 endpoints    │ │
              │   └──────────┘    └────────┬─────────┘ │
              │                            │           │
              │          ┌─────────────────┤           │
              │          │                 │           │
              │   ┌──────┴──────┐   ┌─────┴────────┐ │
              │   │   Neon      │   │  Odds API    │ │
              │   │ PostgreSQL  │   │  47 Books    │ │
              │   │  7 Tables   │   │  3 Markets   │ │
              │   │  2 Views    │   │  15min Poll  │ │
              │   └─────────────┘   └──────────────┘ │
              │                                       │
              │   ┌───────────────────────────────┐   │
              │   │      Anomaly Engine           │   │
              │   │  sync_move · reverse_steam    │   │
              │   │  house_divergence · late_flip  │   │
              │   │  outlier_consensus             │   │
              │   └───────────────────────────────┘   │
              │                                       │
              │   ┌───────────────────────────────┐   │
              │   │    ML Consensus Engine         │   │
              │   │  Weighted ensemble + GPT-4     │   │
              │   │  Sharp: 2.5x  Fade: 0.3x      │   │
              │   │  House lean when conf < 60%    │   │
              │   └───────────────────────────────┘   │
              │                                       │
              │   ┌───────────────────────────────┐   │
              │   │     DarkWave Dashboard         │   │
              │   │  Glass cards · Floating orbs   │   │
              │   │  Bento grid · Game carousel     │   │
              │   │  Pattern feed · AI insights    │   │
              │   └───────────────────────────────┘   │
              │                                       │
              ├───────────────┬─────────────────────┤ │
              │  Widget API   │   Pick Submission    │ │
              │  GET /widget  │   POST /picks        │ │
              └───────────────┴─────────────────────┘ │
                      │                 ▲               │
                      ▼                 │               │
              ┌───────────────┐  ┌─────────────┐       │
              │  Mathew's     │  │ Mathew's    │       │
              │  Site         │  │ Picks       │       │
              │  (Widget)     │  │ (71% Sharp) │       │
              └───────────────┘  └─────────────┘       │
                                                        │
              ┌─────────────────────────────────────────┘
              │
              ▼
       ┌──────────────┐    ┌──────────────┐
       │   Twilio     │    │   Resend     │
       │   SMS Push   │    │   Email      │
       │   Alerts     │    │   Briefs     │
       └──────────────┘    └──────────────┘
```

---

## 7. Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL (or Neon Serverless account)
- The Odds API key (free: 500 req/mo, paid: unlimited)
- OpenAI API key (optional, for AI reasoning)

### Setup
```bash
git clone https://github.com/cryptocreeper94-sudo/lumeline.git
cd lumeline
npm install
cp .env.example .env        # Fill in your keys
npm run db:init              # Create tables
npm run dev                  # Start server with hot reload
```

### Quick Test
```bash
# Health check
curl http://localhost:3000/api/health

# Source leaderboard
curl http://localhost:3000/api/sources

# Submit a pick as Mathew
curl -X POST http://localhost:3000/api/picks \
  -H "Content-Type: application/json" \
  -d '{"source_slug":"mathew","game_id":"uuid","pick_value":"KC -3.5","confidence":85}'

# Trigger ingestion
curl -X POST http://localhost:3000/api/ingest
```

---

## 8. What's Coming

- **Live WebSocket feed** — real-time line movement streaming
- **Historical backtesting** — test consensus model against 3 years of data
- **Multi-sport expansion** — MLB, NHL, UFC, Soccer
- **Mathew's Dashboard** — personal analytics page for his picks
- **Mobile app** — React Native companion for on-the-go alerts

---

*Built with [Lume](https://lume-lang.vercel.app) · DarkWave Studios · Trust Layer Ecosystem*
*"The house always knows. Now you will too."*
