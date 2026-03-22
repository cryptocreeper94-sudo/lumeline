/**
 * LumeLine — Source Scoring Engine
 * Compiled from scoring.lume
 * Tracks source accuracy, CLV, consistency, timing, and auto-tiers.
 */

const SHARP_THRESHOLD = 65;
const RELIABLE_THRESHOLD = 55;
const NEUTRAL_THRESHOLD = 48;

export function assignTier(hitRate) {
  if (hitRate >= SHARP_THRESHOLD) return 'sharp';
  if (hitRate >= RELIABLE_THRESHOLD) return 'reliable';
  if (hitRate >= NEUTRAL_THRESHOLD) return 'neutral';
  return 'fade';
}

export function getTierWeight(tier) {
  const weights = { sharp: 2.5, reliable: 1.5, neutral: 1.0, fade: 0.3 };
  return weights[tier] || 1.0;
}

export function calculateHitRate(picks, results) {
  if (!picks.length) return 0;
  let correct = 0;
  for (const pick of picks) {
    const result = results.find(r => r.game_id === pick.game_id);
    if (result && evaluatePick(pick, result)) correct++;
  }
  return Math.round((correct / picks.length) * 100);
}

export function evaluatePick(pick, result) {
  const diff = (result.home_score || 0) - (result.away_score || 0);
  if (pick.market === 'spread') return (diff + pick.line) > 0;
  if (pick.market === 'moneyline') return pick.odds > 0 ? diff > 0 : diff < 0;
  if (pick.market === 'total') return (result.home_score + result.away_score) > pick.line;
  return false;
}

export function calculateCLV(sourceId, snapshots) {
  const early = snapshots.filter(s => s.source_id === sourceId && s.time_to_game > 120);
  const closing = snapshots.filter(s => s.source_id === sourceId && s.time_to_game < 15);
  if (!early.length || !closing.length) return 0;

  let totalCLV = 0, count = 0;
  for (const e of early) {
    const c = closing.find(s => s.game_id === e.game_id && s.market === e.market);
    if (c) { totalCLV += Math.abs(c.line - e.line); count++; }
  }
  return count ? Math.round((totalCLV / count) * 100) / 100 : 0;
}

export function calculateConsistency(sourceId, snapshots) {
  const gameIds = [...new Set(snapshots.filter(s => s.source_id === sourceId).map(s => s.game_id))];
  let flips = 0, total = 0;

  for (const gid of gameIds) {
    const snaps = snapshots.filter(s => s.source_id === sourceId && s.game_id === gid)
      .sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));
    if (snaps.length > 1) {
      total++;
      let prev = snaps[0].line;
      for (const s of snaps) {
        if ((s.line > 0 && prev < 0) || (s.line < 0 && prev > 0)) flips++;
        prev = s.line;
      }
    }
  }
  return total ? Math.round((1 - flips / total) * 100) : 100;
}

export function calculateTiming(sourceId, snapshots) {
  const gameIds = [...new Set(snapshots.filter(s => s.source_id === sourceId).map(s => s.game_id))];
  let earlyCount = 0;

  for (const gid of gameIds) {
    const all = snapshots.filter(s => s.game_id === gid).sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));
    const src = snapshots.find(s => s.source_id === sourceId && s.game_id === gid);
    if (src && all.length && src.captured_at === all[0].captured_at) earlyCount++;
  }
  return gameIds.length ? Math.round((earlyCount / gameIds.length) * 100) : 50;
}

export function scoreSource(source, picks, results, snapshots) {
  const sourcePicks = picks.filter(p => p.source_id === source.id);
  const hitRate = calculateHitRate(sourcePicks, results);
  return {
    id: source.id,
    name: source.name,
    slug: source.slug,
    tier: assignTier(hitRate),
    accuracy_30d: hitRate,
    clv_score: calculateCLV(source.id, snapshots),
    consistency: calculateConsistency(source.id, snapshots),
    timing_score: calculateTiming(source.id, snapshots),
    total_picks: sourcePicks.length
  };
}

export function scoreAllSources(sources, picks, results, snapshots) {
  return sources
    .map(s => scoreSource(s, picks, results, snapshots))
    .sort((a, b) => b.accuracy_30d - a.accuracy_30d);
}
