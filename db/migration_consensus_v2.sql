-- Lumeline ML Consensus v0.2.0 Schema Migration
-- Adds confidence bands, gradient house lean, anomaly flags, and user ML profile

-- Consensus table upgrades
ALTER TABLE consensus ADD COLUMN IF NOT EXISTS confidence_low INTEGER DEFAULT 0;
ALTER TABLE consensus ADD COLUMN IF NOT EXISTS confidence_high INTEGER DEFAULT 0;
ALTER TABLE consensus ADD COLUMN IF NOT EXISTS confidence_label VARCHAR(16) DEFAULT 'low';
ALTER TABLE consensus ADD COLUMN IF NOT EXISTS house_lean_strength INTEGER DEFAULT 0;
ALTER TABLE consensus ADD COLUMN IF NOT EXISTS market_divergence INTEGER DEFAULT 0;
ALTER TABLE consensus ADD COLUMN IF NOT EXISTS technical_reasoning TEXT;
ALTER TABLE consensus ADD COLUMN IF NOT EXISTS anomaly_flags JSONB DEFAULT '[]';
ALTER TABLE consensus ADD COLUMN IF NOT EXISTS model_version VARCHAR(16) DEFAULT 'v0.1.0';

-- Index for consensus history endpoint
CREATE INDEX IF NOT EXISTS idx_consensus_game_time ON consensus(game_id, generated_at DESC);

-- Anomaly metadata documentation
COMMENT ON COLUMN anomalies.metadata IS 'For reverse_steam/late_flip: { sharp_side, flip_direction, line_before, line_after }';

-- User ML Profile table (P10)
CREATE TABLE IF NOT EXISTS user_ml_profile (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  wr_spread NUMERIC(5,2) DEFAULT 0,
  wr_moneyline NUMERIC(5,2) DEFAULT 0,
  wr_total NUMERIC(5,2) DEFAULT 0,
  wr_parlay NUMERIC(5,2) DEFAULT 0,
  wr_prop NUMERIC(5,2) DEFAULT 0,
  wr_nfl NUMERIC(5,2) DEFAULT 0,
  wr_nba NUMERIC(5,2) DEFAULT 0,
  wr_mlb NUMERIC(5,2) DEFAULT 0,
  wr_nhl NUMERIC(5,2) DEFAULT 0,
  roi_high_confidence NUMERIC(6,2) DEFAULT 0,
  roi_medium_confidence NUMERIC(6,2) DEFAULT 0,
  roi_low_confidence NUMERIC(6,2) DEFAULT 0,
  best_book_slug VARCHAR(64),
  total_settled_bets INTEGER DEFAULT 0,
  last_calculated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_ml_profile_user ON user_ml_profile(user_id);
