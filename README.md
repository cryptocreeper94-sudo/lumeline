# LumeLine

**Odds Intelligence Platform** — Part of the Trust Layer Ecosystem

> *Bringing transparency to lines — because the house always knows. Now you will too.*

Built entirely in [Lume](https://lume-lang.vercel.app), the AI-native programming language.

## What It Does

LumeLine tracks oddsmakers as signal sources, scores their accuracy over time, detects suspicious line manipulation, and uses ML to generate consensus predictions with confidence scores.

- 📊 **Track Sources** — 70+ bookmakers scored on accuracy, timing, consistency, and CLV
- 🔍 **Detect Manipulation** — Synchronized moves, reverse steam traps, house divergence, late flips
- 🎯 **Consensus Engine** — Weighted ensemble with AI-powered analysis and house-lean bias
- 🏠 **House Lean** — When confidence is low, the system defers to the house line
- 🔌 **Integration API** — External picks submission, embeddable widget for partner sites

## Tech Stack

- **Language**: Lume (AI-native, compiles to JavaScript)
- **Database**: PostgreSQL (Neon Serverless)
- **Odds Data**: The Odds API
- **AI**: OpenAI (advisory analysis)
- **Hosting**: Render
- **Design**: DarkWave Canonical (dark glass-card UI)

## Project Structure

```
lumeline/
├── src/
│   ├── app.lume              — Entry point
│   ├── types.lume            — Core type definitions
│   ├── ingestion.lume        — Odds API polling + results
│   ├── scoring.lume          — Source accuracy engine
│   ├── anomaly.lume          — Collusion/manipulation detection
│   ├── consensus.lume        — ML consensus engine
│   ├── integration.lume      — External picks API
│   └── ui/
│       └── dashboard.lume    — Premium dashboard UI
├── server/
│   └── index.lume            — API server
├── lume.config.json
├── render.yaml
└── package.json
```

## Quick Start

```bash
# Install
npm install

# Run dashboard
lume build src/app.lume --target=browser

# Run server
lume run server/index.lume
```

## Part of the Trust Layer Ecosystem

LumeLine is connected to the [Trust Layer](https://dwtl.io) ecosystem — shared identity, shared design, shared philosophy.

---

**Built with Lume** · DarkWave Studios · MIT License
