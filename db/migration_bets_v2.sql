-- ═══════════════════════════════════════════════════════════
--  LumeLine — Betting Wallet V2 Migration
--  Advanced bet types, parlay legs, promos, live bets
--  Run: psql $DATABASE_URL -f db/migration_bets_v2.sql
-- ═══════════════════════════════════════════════════════════

-- ═══ Expand user_bets ═══
ALTER TABLE user_bets ADD COLUMN IF NOT EXISTS parlay_type    VARCHAR(32);
ALTER TABLE user_bets ADD COLUMN IF NOT EXISTS leg_count      INTEGER DEFAULT 1;
ALTER TABLE user_bets ADD COLUMN IF NOT EXISTS promo_type     VARCHAR(64);
ALTER TABLE user_bets ADD COLUMN IF NOT EXISTS promo_detail   VARCHAR(256);
ALTER TABLE user_bets ADD COLUMN IF NOT EXISTS teaser_points  NUMERIC(4,1);
ALTER TABLE user_bets ADD COLUMN IF NOT EXISTS live_bet       BOOLEAN DEFAULT FALSE;
ALTER TABLE user_bets ADD COLUMN IF NOT EXISTS cash_out       NUMERIC(10,2);
ALTER TABLE user_bets ADD COLUMN IF NOT EXISTS confirmation_id VARCHAR(128);

-- ═══ Parlay / SGP legs ═══
CREATE TABLE IF NOT EXISTS bet_legs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bet_id      UUID NOT NULL REFERENCES user_bets(id) ON DELETE CASCADE,
    leg_number  INTEGER NOT NULL,
    pick        VARCHAR(256) NOT NULL,
    odds        INTEGER,
    bet_type    VARCHAR(32) DEFAULT 'spread',
    prop_type   VARCHAR(64),
    prop_line   NUMERIC(6,1),
    game_id     UUID REFERENCES games(id) ON DELETE SET NULL,
    home_team   VARCHAR(128),
    away_team   VARCHAR(128),
    sport       VARCHAR(32),
    status      VARCHAR(16) DEFAULT 'pending',
    score_at_bet VARCHAR(32),
    settled_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(bet_id, leg_number)
);

CREATE INDEX IF NOT EXISTS idx_bet_legs_bet ON bet_legs(bet_id);
CREATE INDEX IF NOT EXISTS idx_bet_legs_status ON bet_legs(status);
