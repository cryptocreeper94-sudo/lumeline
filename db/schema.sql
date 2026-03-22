-- ═══════════════════════════════════════════════════════════
--  LumeLine — PostgreSQL Schema (Neon Serverless)
--  Odds intelligence data layer for the Trust Layer Ecosystem
--  Run: psql $DATABASE_URL -f schema.sql
-- ═══════════════════════════════════════════════════════════

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ═══ ENUM TYPES ═══
CREATE TYPE source_tier AS ENUM ('sharp', 'reliable', 'neutral', 'fade', 'unranked');
CREATE TYPE anomaly_severity AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE anomaly_signal AS ENUM ('sync_move', 'reverse_steam', 'house_divergence', 'late_flip', 'outlier_consensus');
CREATE TYPE market_type AS ENUM ('spread', 'moneyline', 'total', 'prop');

-- ═══ SOURCES (Oddsmakers + External Picks) ═══
CREATE TABLE sources (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(128) NOT NULL UNIQUE,
    slug            VARCHAR(128) NOT NULL UNIQUE,
    type            VARCHAR(32) DEFAULT 'bookmaker',  -- bookmaker | external | model
    tier            source_tier DEFAULT 'unranked',
    accuracy_7d     NUMERIC(5,2) DEFAULT 0,
    accuracy_30d    NUMERIC(5,2) DEFAULT 0,
    accuracy_90d    NUMERIC(5,2) DEFAULT 0,
    clv_score       NUMERIC(5,2) DEFAULT 0,
    consistency     NUMERIC(5,2) DEFAULT 0,
    timing_score    NUMERIC(5,2) DEFAULT 0,
    total_picks     INTEGER DEFAULT 0,
    correct_picks   INTEGER DEFAULT 0,
    last_updated    TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    metadata        JSONB DEFAULT '{}'
);

-- ═══ GAMES ═══
CREATE TABLE games (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id     VARCHAR(128) UNIQUE,
    sport           VARCHAR(32) NOT NULL,
    league          VARCHAR(32) NOT NULL,
    home_team       VARCHAR(128) NOT NULL,
    away_team       VARCHAR(128) NOT NULL,
    start_time      TIMESTAMPTZ NOT NULL,
    status          VARCHAR(32) DEFAULT 'upcoming',  -- upcoming | live | final
    home_score      INTEGER,
    away_score      INTEGER,
    winner          VARCHAR(8),  -- home | away | push
    integrity_score INTEGER DEFAULT 100,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ ODDS SNAPSHOTS (Line Movements) ═══
CREATE TABLE odds_snapshots (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    source_id       UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    market          market_type NOT NULL,
    line            NUMERIC(6,2),
    odds_home       INTEGER,
    odds_away       INTEGER,
    over_under      NUMERIC(5,1),
    captured_at     TIMESTAMPTZ DEFAULT NOW(),
    time_to_game    INTEGER,  -- minutes to game start
    metadata        JSONB DEFAULT '{}'
);

-- ═══ ANOMALIES ═══
CREATE TABLE anomalies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    signal_type     anomaly_signal NOT NULL,
    severity        anomaly_severity NOT NULL,
    description     TEXT NOT NULL,
    sources_involved UUID[] DEFAULT '{}',
    confidence      NUMERIC(5,2) DEFAULT 0,
    detected_at     TIMESTAMPTZ DEFAULT NOW(),
    resolved        BOOLEAN DEFAULT FALSE,
    metadata        JSONB DEFAULT '{}'
);

-- ═══ CONSENSUS PREDICTIONS ═══
CREATE TABLE consensus (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    home_likelihood INTEGER NOT NULL CHECK (home_likelihood >= 0 AND home_likelihood <= 100),
    away_likelihood INTEGER NOT NULL CHECK (away_likelihood >= 0 AND away_likelihood <= 100),
    confidence      INTEGER NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
    alignment       INTEGER DEFAULT 0,
    integrity       INTEGER DEFAULT 100,
    house_lean      BOOLEAN DEFAULT FALSE,
    reasoning       TEXT,
    sources_agree   INTEGER DEFAULT 0,
    sources_disagree INTEGER DEFAULT 0,
    model_version   VARCHAR(32) DEFAULT 'v0.1.0',
    generated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ EXTERNAL PICKS (Mathew, etc.) ═══
CREATE TABLE picks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id       UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    market          market_type DEFAULT 'spread',
    pick_value      VARCHAR(128) NOT NULL,
    confidence      INTEGER DEFAULT 50 CHECK (confidence >= 0 AND confidence <= 100),
    result          VARCHAR(16),  -- win | loss | push | pending
    submitted_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ INGESTION LOG ═══
CREATE TABLE ingestion_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_at          TIMESTAMPTZ DEFAULT NOW(),
    sport           VARCHAR(32),
    source_count    INTEGER DEFAULT 0,
    snapshot_count  INTEGER DEFAULT 0,
    anomaly_count   INTEGER DEFAULT 0,
    duration_ms     INTEGER DEFAULT 0,
    status          VARCHAR(16) DEFAULT 'success',
    error           TEXT
);

-- ═══ INDEXES ═══
CREATE INDEX idx_snapshots_game ON odds_snapshots(game_id);
CREATE INDEX idx_snapshots_source ON odds_snapshots(source_id);
CREATE INDEX idx_snapshots_captured ON odds_snapshots(captured_at DESC);
CREATE INDEX idx_snapshots_game_source ON odds_snapshots(game_id, source_id);
CREATE INDEX idx_anomalies_game ON anomalies(game_id);
CREATE INDEX idx_anomalies_severity ON anomalies(severity);
CREATE INDEX idx_consensus_game ON consensus(game_id);
CREATE INDEX idx_games_sport ON games(sport);
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_games_start ON games(start_time);
CREATE INDEX idx_picks_source ON picks(source_id);
CREATE INDEX idx_picks_game ON picks(game_id);

-- ═══ VIEWS ═══

-- Active games with latest consensus
CREATE VIEW v_active_games AS
SELECT 
    g.*,
    c.home_likelihood,
    c.away_likelihood,
    c.confidence,
    c.integrity,
    c.house_lean,
    c.reasoning,
    c.sources_agree,
    c.sources_disagree,
    (SELECT COUNT(*) FROM anomalies a WHERE a.game_id = g.id AND NOT a.resolved) AS active_anomalies
FROM games g
LEFT JOIN LATERAL (
    SELECT * FROM consensus 
    WHERE game_id = g.id 
    ORDER BY generated_at DESC 
    LIMIT 1
) c ON TRUE
WHERE g.status IN ('upcoming', 'live')
ORDER BY g.start_time;

-- Source leaderboard
CREATE VIEW v_source_leaderboard AS
SELECT 
    s.*,
    RANK() OVER (ORDER BY s.accuracy_30d DESC) AS rank,
    (SELECT COUNT(*) FROM picks p WHERE p.source_id = s.id AND p.result = 'win') AS wins,
    (SELECT COUNT(*) FROM picks p WHERE p.source_id = s.id AND p.result = 'loss') AS losses
FROM sources s
ORDER BY s.accuracy_30d DESC;

-- ═══ SEED: Default Sources ═══
INSERT INTO sources (name, slug, type, tier, accuracy_30d) VALUES
    ('Pinnacle', 'pinnacle', 'bookmaker', 'sharp', 68.0),
    ('Circa Sports', 'circa', 'bookmaker', 'sharp', 64.0),
    ('BetMGM', 'betmgm', 'bookmaker', 'reliable', 58.0),
    ('DraftKings', 'draftkings', 'bookmaker', 'reliable', 56.0),
    ('FanDuel', 'fanduel', 'bookmaker', 'neutral', 52.0),
    ('BetRivers', 'betrivers', 'bookmaker', 'neutral', 49.0),
    ('Caesars', 'caesars', 'bookmaker', 'fade', 44.0),
    ('PointsBet', 'pointsbet', 'bookmaker', 'neutral', 51.0),
    ('BetUS', 'betus', 'bookmaker', 'fade', 42.0),
    ('Bovada', 'bovada', 'bookmaker', 'neutral', 50.0),
    ('Mathew', 'mathew', 'external', 'sharp', 71.0),
    ('Bet365', 'bet365', 'bookmaker', 'reliable', 59.0)
ON CONFLICT (slug) DO NOTHING;
