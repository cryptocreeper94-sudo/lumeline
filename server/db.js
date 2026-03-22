import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export const query = (text, params) => pool.query(text, params);

// ─── Games ───
export async function getActiveGames(sport = null) {
  const q = sport
    ? `SELECT * FROM v_active_games WHERE sport = $1 ORDER BY start_time`
    : `SELECT * FROM v_active_games ORDER BY start_time`;
  const { rows } = sport ? await query(q, [sport]) : await query(q);
  return rows;
}

export async function upsertGame(game) {
  const { rows } = await query(`
    INSERT INTO games (external_id, sport, league, home_team, away_team, start_time, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (external_id) DO UPDATE SET 
      status = EXCLUDED.status, updated_at = NOW()
    RETURNING *
  `, [game.external_id, game.sport, game.league, game.home_team, game.away_team, game.start_time, game.status || 'upcoming']);
  return rows[0];
}

// ─── Snapshots ───
export async function insertSnapshot(snapshot) {
  const { rows } = await query(`
    INSERT INTO odds_snapshots (game_id, source_id, market, line, odds_home, odds_away, over_under, time_to_game)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [snapshot.game_id, snapshot.source_id, snapshot.market, snapshot.line, snapshot.odds_home, snapshot.odds_away, snapshot.over_under, snapshot.time_to_game]);
  return rows[0];
}

export async function getSnapshotsForGame(gameId) {
  const { rows } = await query(`
    SELECT os.*, s.name as source_name, s.tier as source_tier
    FROM odds_snapshots os JOIN sources s ON os.source_id = s.id
    WHERE os.game_id = $1 ORDER BY os.captured_at DESC
  `, [gameId]);
  return rows;
}

// ─── Sources ───
export async function getSources() {
  const { rows } = await query(`SELECT * FROM v_source_leaderboard`);
  return rows;
}

export async function getSourceBySlug(slug) {
  const { rows } = await query(`SELECT * FROM sources WHERE slug = $1`, [slug]);
  return rows[0];
}

export async function updateSourceAccuracy(sourceId, accuracy30d, tier) {
  await query(`
    UPDATE sources SET accuracy_30d = $2, tier = $3, last_updated = NOW() WHERE id = $1
  `, [sourceId, accuracy30d, tier]);
}

// ─── Anomalies ───
export async function insertAnomaly(anomaly) {
  const { rows } = await query(`
    INSERT INTO anomalies (game_id, signal_type, severity, description, sources_involved, confidence)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
  `, [anomaly.game_id, anomaly.signal_type, anomaly.severity, anomaly.description, anomaly.sources_involved, anomaly.confidence]);
  return rows[0];
}

export async function getAnomaliesForGame(gameId) {
  const { rows } = await query(`SELECT * FROM anomalies WHERE game_id = $1 AND NOT resolved ORDER BY detected_at DESC`, [gameId]);
  return rows;
}

// ─── Consensus ───
export async function insertConsensus(c) {
  const { rows } = await query(`
    INSERT INTO consensus (game_id, home_likelihood, away_likelihood, confidence, alignment, integrity, house_lean, reasoning, sources_agree, sources_disagree)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
  `, [c.game_id, c.home_likelihood, c.away_likelihood, c.confidence, c.alignment, c.integrity, c.house_lean, c.reasoning, c.sources_agree, c.sources_disagree]);
  return rows[0];
}

// ─── Picks ───
export async function submitPick(pick) {
  const { rows } = await query(`
    INSERT INTO picks (source_id, game_id, market, pick_value, confidence)
    VALUES ($1, $2, $3, $4, $5) RETURNING *
  `, [pick.source_id, pick.game_id, pick.market, pick.pick_value, pick.confidence]);
  return rows[0];
}

// ─── Ingestion Log ───
export async function logIngestion(log) {
  await query(`
    INSERT INTO ingestion_log (sport, source_count, snapshot_count, anomaly_count, duration_ms, status, error)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [log.sport, log.source_count, log.snapshot_count, log.anomaly_count, log.duration_ms, log.status, log.error]);
}

export default { query, getActiveGames, upsertGame, insertSnapshot, getSnapshotsForGame, getSources, getSourceBySlug, updateSourceAccuracy, insertAnomaly, getAnomaliesForGame, insertConsensus, submitPick, logIngestion };
