-- ═══════════════════════════════════════════════════════════
--  LumeLine — Betting Wallet Migration
--  My Bets: user_sportsbooks + user_bets
--  Run: psql $DATABASE_URL -f db/migration_bets.sql
-- ═══════════════════════════════════════════════════════════

-- User's connected sportsbook accounts
CREATE TABLE IF NOT EXISTS user_sportsbooks (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_name   VARCHAR(64) NOT NULL,
    book_slug   VARCHAR(64) NOT NULL,
    balance     NUMERIC(10,2) DEFAULT 0,
    color       VARCHAR(7) DEFAULT '#06b6d4',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, book_slug)
);

-- Individual bets (the core wallet)
CREATE TABLE IF NOT EXISTS user_bets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sportsbook_id   UUID REFERENCES user_sportsbooks(id) ON DELETE SET NULL,
    game_id         UUID REFERENCES games(id) ON DELETE SET NULL,
    bet_type        VARCHAR(32) DEFAULT 'spread',
    pick            VARCHAR(256) NOT NULL,
    odds            INTEGER,
    stake           NUMERIC(10,2),
    potential_win   NUMERIC(10,2),
    status          VARCHAR(16) DEFAULT 'active',
    result_amount   NUMERIC(10,2),
    sport           VARCHAR(32),
    home_team       VARCHAR(128),
    away_team       VARCHAR(128),
    game_time       TIMESTAMPTZ,
    source          VARCHAR(32) DEFAULT 'manual',
    raw_data        JSONB DEFAULT '{}',
    notes           TEXT,
    placed_at       TIMESTAMPTZ DEFAULT NOW(),
    settled_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_bets_user ON user_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_bets_status ON user_bets(status);
CREATE INDEX IF NOT EXISTS idx_user_bets_game ON user_bets(game_id);
CREATE INDEX IF NOT EXISTS idx_user_bets_placed ON user_bets(placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sportsbooks_user ON user_sportsbooks(user_id);
