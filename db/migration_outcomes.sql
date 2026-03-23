-- ═══════════════════════════════════════════════════════════
--  LumeLine — Outcome Tracking Migration
--  Adds game result tracking, consensus accuracy evaluation,
--  and rolling performance stats (modeled after DarkWave Pulse)
-- ═══════════════════════════════════════════════════════════

-- ═══ GAME OUTCOMES (Final scores + results) ═══
CREATE TABLE IF NOT EXISTS game_outcomes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    
    -- Final Scores
    home_score      INTEGER NOT NULL,
    away_score      INTEGER NOT NULL,
    winner          VARCHAR(8) NOT NULL,             -- 'home' | 'away' | 'push'
    
    -- Spread Results
    spread_result   VARCHAR(8),                       -- 'home' | 'away' | 'push'
    closing_spread  NUMERIC(6,2),                     -- Final spread at game time
    
    -- Totals
    total_points    NUMERIC(6,1),                     -- Combined score
    over_under_result VARCHAR(8),                     -- 'over' | 'under' | 'push'
    closing_total   NUMERIC(5,1),                     -- Closing O/U line
    
    evaluated_at    TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(game_id)
);

-- ═══ CONSENSUS OUTCOMES (Did our prediction hit?) ═══
CREATE TABLE IF NOT EXISTS consensus_outcomes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    consensus_id    UUID REFERENCES consensus(id) ON DELETE SET NULL,
    
    -- What We Predicted
    predicted_winner VARCHAR(8) NOT NULL,             -- 'home' | 'away'
    predicted_confidence INTEGER NOT NULL,             -- 0-100
    predicted_integrity INTEGER NOT NULL,              -- 0-100
    predicted_house_lean BOOLEAN DEFAULT FALSE,
    
    -- Actual Result
    actual_winner    VARCHAR(8) NOT NULL,              -- 'home' | 'away' | 'push'
    
    -- Outcome Classification
    is_correct       BOOLEAN NOT NULL,
    outcome          VARCHAR(20) NOT NULL,             -- 'WIN' | 'LOSS' | 'PUSH' | 'NO_PICK'
    
    -- Performance Metrics
    confidence_bucket VARCHAR(10) NOT NULL,            -- 'high' (70+), 'medium' (55-69), 'low' (0-54)
    sport            VARCHAR(32) NOT NULL,
    
    evaluated_at     TIMESTAMPTZ DEFAULT NOW(),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(game_id)
);

-- ═══ ACCURACY STATS (Aggregated — like Pulse's prediction_accuracy_stats) ═══
CREATE TABLE IF NOT EXISTS accuracy_stats (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Grouping (null = global stats)
    sport           VARCHAR(32),                       -- null = all sports
    confidence_bucket VARCHAR(10),                     -- null = all buckets
    
    -- Accuracy Metrics
    total_predictions INTEGER NOT NULL DEFAULT 0,
    correct_predictions INTEGER NOT NULL DEFAULT 0,
    win_rate        NUMERIC(5,2) NOT NULL DEFAULT 0,
    
    -- Performance
    avg_confidence  NUMERIC(5,2) DEFAULT 0,
    high_conf_wins  INTEGER DEFAULT 0,
    high_conf_total INTEGER DEFAULT 0,
    high_conf_rate  NUMERIC(5,2) DEFAULT 0,
    
    -- Streaks
    current_streak  INTEGER DEFAULT 0,                -- Positive = wins, negative = losses
    longest_win_streak INTEGER DEFAULT 0,
    longest_loss_streak INTEGER DEFAULT 0,
    
    -- Time Window
    window          VARCHAR(10) NOT NULL DEFAULT 'all', -- 'all' | '7d' | '30d' | '90d'
    
    last_prediction_at TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- NULL-safe unique index (COALESCE handles NULLs for sport and confidence_bucket)
CREATE UNIQUE INDEX IF NOT EXISTS idx_accuracy_stats_unique 
    ON accuracy_stats (COALESCE(sport, '__ALL__'), COALESCE(confidence_bucket, '__ALL__'), window);

-- ═══ SOURCE ACCURACY LOG (Per-source outcome tracking) ═══
CREATE TABLE IF NOT EXISTS source_outcomes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id       UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    
    -- What This Source Had
    market          VARCHAR(20) NOT NULL,              -- 'spread' | 'moneyline' | 'total'
    predicted_line  NUMERIC(6,2),
    predicted_odds  INTEGER,
    
    -- Result
    is_correct      BOOLEAN NOT NULL,
    
    evaluated_at    TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(source_id, game_id, market)
);

-- ═══ INDEXES ═══
CREATE INDEX IF NOT EXISTS idx_game_outcomes_game ON game_outcomes(game_id);
CREATE INDEX IF NOT EXISTS idx_consensus_outcomes_game ON consensus_outcomes(game_id);
CREATE INDEX IF NOT EXISTS idx_consensus_outcomes_sport ON consensus_outcomes(sport);
CREATE INDEX IF NOT EXISTS idx_consensus_outcomes_correct ON consensus_outcomes(is_correct);
CREATE INDEX IF NOT EXISTS idx_consensus_outcomes_bucket ON consensus_outcomes(confidence_bucket);
CREATE INDEX IF NOT EXISTS idx_accuracy_stats_sport ON accuracy_stats(sport);
CREATE INDEX IF NOT EXISTS idx_accuracy_stats_window ON accuracy_stats(window);
CREATE INDEX IF NOT EXISTS idx_source_outcomes_source ON source_outcomes(source_id);

-- ═══ VIEW: Accuracy Dashboard ═══
CREATE OR REPLACE VIEW v_accuracy_dashboard AS
SELECT 
    COALESCE(sport, 'ALL') AS sport,
    window,
    total_predictions,
    correct_predictions,
    win_rate,
    high_conf_rate,
    current_streak,
    longest_win_streak,
    updated_at
FROM accuracy_stats
WHERE confidence_bucket IS NULL
ORDER BY window, sport;
