-- ═══════════════════════════════════════════════════════════
--  LumeLine — House Decoder Schema Extension
--  Adds result tracking, house accuracy scoring, O/U analysis
--  Run: psql $DATABASE_URL -f house_decoder_schema.sql
-- ═══════════════════════════════════════════════════════════

-- ═══ GAME RESULTS (granular) ═══
CREATE TABLE IF NOT EXISTS game_results (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    final_home_score INTEGER NOT NULL,
    final_away_score INTEGER NOT NULL,
    actual_spread    NUMERIC(6,2) NOT NULL,  -- home_score - away_score (negative = away won by more)
    actual_total     NUMERIC(6,1) NOT NULL,  -- home_score + away_score
    actual_winner    VARCHAR(8) NOT NULL,     -- home | away
    actual_ats_winner VARCHAR(8),             -- home | away | push (against the spread)
    recorded_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ HOUSE ACCURACY (per source, per market, rolling) ═══
CREATE TABLE IF NOT EXISTS house_accuracy (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id       UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    market          VARCHAR(16) NOT NULL,     -- spread | moneyline | total
    sport           VARCHAR(16) NOT NULL,
    period          VARCHAR(8) NOT NULL,      -- 7d | 30d | 90d | all
    total_games     INTEGER DEFAULT 0,
    correct         INTEGER DEFAULT 0,
    accuracy_pct    NUMERIC(5,2) DEFAULT 0,
    avg_deviation   NUMERIC(6,2) DEFAULT 0,   -- avg distance from actual result
    bias            NUMERIC(6,2) DEFAULT 0,   -- positive = favors home, negative = favors away
    best_matchup    VARCHAR(64),              -- team combo where this source is most accurate
    worst_matchup   VARCHAR(64),              -- team combo where this source is worst
    calculated_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_id, market, sport, period)
);

-- ═══ OVER/UNDER ANALYSIS ═══
CREATE TABLE IF NOT EXISTS ou_analysis (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    consensus_total  NUMERIC(5,1),             -- what the house set the O/U at
    actual_total     NUMERIC(5,1),             -- what actually happened
    delta            NUMERIC(5,1),             -- actual - consensus (positive = went over)
    went_over        BOOLEAN,
    num_sources_over INTEGER DEFAULT 0,        -- how many books set higher totals
    num_sources_under INTEGER DEFAULT 0,       -- how many books set lower totals
    ou_consensus_spread NUMERIC(4,1),          -- max O/U - min O/U (how much books disagreed)
    recorded_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ HOUSE DECODER SIGNALS ═══
CREATE TABLE IF NOT EXISTS decoder_signals (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    signal_type     VARCHAR(32) NOT NULL,     -- see types below
    market          VARCHAR(16) NOT NULL,
    description     TEXT NOT NULL,
    confidence      INTEGER DEFAULT 50,       -- 0-100
    prediction      VARCHAR(128),             -- what the signal suggests
    was_correct     BOOLEAN,                  -- filled after game concludes
    metadata        JSONB DEFAULT '{}',
    detected_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Signal types:
-- 'house_trap'        — line set to bait public money (house knows better)
-- 'sharp_divergence'  — sharp books diverge from recreational books
-- 'total_mismatch'    — O/U doesn't match recent scoring trends
-- 'reverse_indicator' — house wrong so often on this pattern it becomes a fade signal
-- 'inflection_point'  — line moved significantly then settled (house found true value)
-- 'public_bait'       — line set at a popular number to attract casual bettors
-- 'steam_confirmed'   — sharp money moved line and result confirmed the move

-- ═══ MATCHUP PATTERNS (team-level trends) ═══
CREATE TABLE IF NOT EXISTS matchup_patterns (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    home_team       VARCHAR(128) NOT NULL,
    away_team       VARCHAR(128) NOT NULL,
    sport           VARCHAR(16) NOT NULL,
    games_played    INTEGER DEFAULT 0,
    home_covers     INTEGER DEFAULT 0,        -- how often home covers the spread
    away_covers     INTEGER DEFAULT 0,
    overs           INTEGER DEFAULT 0,         -- how often this matchup goes over
    unders          INTEGER DEFAULT 0,
    avg_total       NUMERIC(5,1) DEFAULT 0,   -- avg combined score
    avg_spread      NUMERIC(5,1) DEFAULT 0,   -- avg point differential
    house_spread_accuracy NUMERIC(5,2) DEFAULT 0,  -- how accurate house spread is for this matchup
    house_total_accuracy  NUMERIC(5,2) DEFAULT 0,  -- how accurate house total is
    last_updated    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(home_team, away_team, sport)
);

-- ═══ INDEXES ═══
CREATE INDEX IF NOT EXISTS idx_game_results_game ON game_results(game_id);
CREATE INDEX IF NOT EXISTS idx_house_accuracy_source ON house_accuracy(source_id);
CREATE INDEX IF NOT EXISTS idx_house_accuracy_market ON house_accuracy(market, sport);
CREATE INDEX IF NOT EXISTS idx_ou_analysis_game ON ou_analysis(game_id);
CREATE INDEX IF NOT EXISTS idx_decoder_signals_game ON decoder_signals(game_id);
CREATE INDEX IF NOT EXISTS idx_decoder_signals_type ON decoder_signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_matchup_patterns_teams ON matchup_patterns(home_team, away_team);

-- ═══ VIEW: House Report Card ═══
CREATE OR REPLACE VIEW v_house_report_card AS
SELECT 
    s.name AS source_name,
    s.slug,
    s.tier,
    ha.market,
    ha.sport,
    ha.period,
    ha.total_games,
    ha.correct,
    ha.accuracy_pct,
    ha.avg_deviation,
    ha.bias,
    ha.best_matchup,
    ha.worst_matchup
FROM house_accuracy ha
JOIN sources s ON ha.source_id = s.id
ORDER BY ha.accuracy_pct DESC;

-- ═══ VIEW: O/U Trends ═══
CREATE OR REPLACE VIEW v_ou_trends AS
SELECT 
    g.sport,
    COUNT(*) AS total_games,
    SUM(CASE WHEN oa.went_over THEN 1 ELSE 0 END) AS overs,
    SUM(CASE WHEN NOT oa.went_over THEN 1 ELSE 0 END) AS unders,
    ROUND(AVG(oa.delta), 1) AS avg_delta,
    ROUND(AVG(oa.ou_consensus_spread), 1) AS avg_book_disagreement,
    ROUND(100.0 * SUM(CASE WHEN ABS(oa.delta) <= 3 THEN 1 ELSE 0 END) / COUNT(*), 1) AS house_within_3pts_pct
FROM ou_analysis oa
JOIN games g ON oa.game_id = g.id
GROUP BY g.sport;
