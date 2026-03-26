# LumeLine

**Odds Intelligence Platform** — Part of the Trust Layer Ecosystem

> *Bringing transparency to lines — because the house always knows. Now you will too.*

## What It Does

LumeLine tracks oddsmakers as signal sources, scores their accuracy over time, detects suspicious line manipulation, and uses ML to generate consensus predictions with confidence scores.

- 📊 **Track Sources** — 47+ bookmakers scored on accuracy, timing, consistency, and CLV
- 🔍 **Detect Manipulation** — Synchronized moves, reverse steam traps, house divergence, late flips
- 🎯 **Consensus Engine** — Weighted ensemble with AI-powered analysis and house-lean bias
- 🏠 **House Lean** — When confidence is low, the system defers to the house line
- 🔌 **Integration API** — External picks submission, embeddable widget for partner sites

## Tech Stack

- **Backend**: Node.js 20 LTS + Express
- **Database**: PostgreSQL (Neon Serverless)
- **Authentication**: Trust Layer SSO (JWT)
- **Odds Data**: The Odds API
- **AI**: OpenAI (Advisory Analysis) & ElevenLabs (Voice)
- **Hosting**: Render
- **Design**: DarkWave Canonical (Vanilla JS/CSS)

## Project Structure

```
lumeline/
├── server/
│   ├── server.js        — Main Express server and scheduler
│   ├── agent.js         — Lume Agent voice/chat interface
│   ├── auth.js          — Trust Layer SSO middleware
│   ├── bets.js          — Bet slip importing and OCR 
│   ├── consensus.js     — ML consensus mathematics
│   ├── ingestion.js     — Odds API polling logic
│   ├── scoring.js       — Source accuracy logic
│   ├── anomalies.js     — Integrity anomaly detection
│   └── ai-guardrails.js — Ecosystem security middleware
├── db/
│   └── migration*.sql   — Database schema definitions
└── *.html               — Static HTML interfaces (index, admin, bets, pricing)
```

## Quick Start

```bash
# Install dependencies
npm install

# Start server (runs on port 3000 by default)
node server/server.js
```

## Part of the Trust Layer Ecosystem

LumeLine generates revenue alongside King Capper in a 50/50 partnership, distributed via Orbit Staffing.

---

**Trust Layer** · DarkWave Studios · MIT License
