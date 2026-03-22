/**
 * LumeLine — Anomaly & Collusion Detection
 * Compiled from anomaly.lume
 * Detects: sync moves, reverse steam, house divergence, late flips.
 */

const SYNC_WINDOW_MINUTES = 5;
const SYNC_MIN_SOURCES = 3;
const DIVERGENCE_THRESHOLD = 3.5;

function classifySyncSeverity(count) {
  if (count >= 6) return 'critical';
  if (count >= 4) return 'high';
  return 'medium';
}

export function detectSyncMoves(snapshots, gameId) {
  const gameSnaps = snapshots.filter(s => s.game_id === gameId);
  const anomalies = [];

  // Group by time windows
  const sorted = [...gameSnaps].sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));
  if (!sorted.length) return anomalies;

  const windowMs = SYNC_WINDOW_MINUTES * 60 * 1000;
  let windowStart = new Date(sorted[0].captured_at).getTime();
  let currentWindow = [];

  for (const snap of sorted) {
    const t = new Date(snap.captured_at).getTime();
    if (t - windowStart > windowMs) {
      checkWindow(currentWindow, gameId, anomalies);
      currentWindow = [snap];
      windowStart = t;
    } else {
      currentWindow.push(snap);
    }
  }
  checkWindow(currentWindow, gameId, anomalies);
  return anomalies;
}

function checkWindow(snaps, gameId, anomalies) {
  const upSources = [...new Set(snaps.filter(s => s.line > 0).map(s => s.source_id))];
  const downSources = [...new Set(snaps.filter(s => s.line < 0).map(s => s.source_id))];

  if (upSources.length >= SYNC_MIN_SOURCES) {
    anomalies.push({
      game_id: gameId, signal_type: 'sync_move',
      severity: classifySyncSeverity(upSources.length),
      description: `${upSources.length} sources moved up within ${SYNC_WINDOW_MINUTES} minutes`,
      sources_involved: upSources, confidence: 80,
      detected_at: new Date().toISOString()
    });
  }
  if (downSources.length >= SYNC_MIN_SOURCES) {
    anomalies.push({
      game_id: gameId, signal_type: 'sync_move',
      severity: classifySyncSeverity(downSources.length),
      description: `${downSources.length} sources moved down within ${SYNC_WINDOW_MINUTES} minutes`,
      sources_involved: downSources, confidence: 80,
      detected_at: new Date().toISOString()
    });
  }
}

export function detectReverseSteam(snapshots, gameId) {
  const sorted = snapshots.filter(s => s.game_id === gameId)
    .sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));
  const sources = [...new Set(sorted.map(s => s.source_id))];
  const anomalies = [];

  for (const srcId of sources) {
    const srcSnaps = sorted.filter(s => s.source_id === srcId);
    if (srcSnaps.length >= 3) {
      const first = srcSnaps[0], mid = srcSnaps[Math.floor(srcSnaps.length / 2)], last = srcSnaps[srcSnaps.length - 1];
      const movedOut = Math.abs(mid.line - first.line);
      const cameBack = Math.abs(last.line - first.line);

      if (movedOut > 2 && cameBack < 0.5) {
        anomalies.push({
          game_id: gameId, signal_type: 'reverse_steam', severity: 'high',
          description: `Source moved ${movedOut.toFixed(1)} points then snapped back — possible trap`,
          sources_involved: [srcId], confidence: 85,
          detected_at: new Date().toISOString()
        });
      }
    }
  }
  return anomalies;
}

export function detectHouseDivergence(snapshots, gameId, sources) {
  const sharpIds = sources.filter(s => s.tier === 'sharp').map(s => s.id);
  const publicIds = sources.filter(s => s.tier === 'neutral' || s.tier === 'reliable').map(s => s.id);
  const anomalies = [];

  const sharpSnaps = snapshots.filter(s => s.game_id === gameId && sharpIds.includes(s.source_id));
  const publicSnaps = snapshots.filter(s => s.game_id === gameId && publicIds.includes(s.source_id));

  if (sharpSnaps.length && publicSnaps.length) {
    const sharpAvg = sharpSnaps.reduce((a, s) => a + (s.line || 0), 0) / sharpSnaps.length;
    const publicAvg = publicSnaps.reduce((a, s) => a + (s.line || 0), 0) / publicSnaps.length;
    const div = Math.abs(sharpAvg - publicAvg);

    if (div >= DIVERGENCE_THRESHOLD) {
      anomalies.push({
        game_id: gameId, signal_type: 'house_divergence', severity: 'medium',
        description: `Sharp vs. public divergence of ${div.toFixed(1)} points`,
        sources_involved: [...sharpIds, ...publicIds], confidence: 75,
        detected_at: new Date().toISOString()
      });
    }
  }
  return anomalies;
}

export function detectLateFlips(snapshots, gameId, sources) {
  const reliable = sources.filter(s => s.tier === 'sharp' || s.tier === 'reliable');
  const anomalies = [];

  for (const source of reliable) {
    const sorted = snapshots.filter(s => s.game_id === gameId && s.source_id === source.id)
      .sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));

    if (sorted.length >= 2) {
      const last = sorted[sorted.length - 1], prev = sorted[sorted.length - 2];
      const flipped = (last.line > 0 && prev.line < 0) || (last.line < 0 && prev.line > 0);

      if (flipped && last.time_to_game < 60) {
        anomalies.push({
          game_id: gameId, signal_type: 'late_flip', severity: 'high',
          description: `${source.name} (${source.tier}) flipped direction within ${last.time_to_game}min of game time`,
          sources_involved: [source.id], confidence: 90,
          detected_at: new Date().toISOString()
        });
      }
    }
  }
  return anomalies;
}

export function calculateIntegrity(gameId, anomalies) {
  const gameAnom = anomalies.filter(a => a.game_id === gameId);
  let score = 100;
  for (const a of gameAnom) {
    if (a.severity === 'critical') score -= 30;
    else if (a.severity === 'high') score -= 20;
    else if (a.severity === 'medium') score -= 10;
    else score -= 5;
  }
  return Math.max(0, score);
}

export function scanGame(gameId, snapshots, sources) {
  const all = [
    ...detectSyncMoves(snapshots, gameId),
    ...detectReverseSteam(snapshots, gameId),
    ...detectHouseDivergence(snapshots, gameId, sources),
    ...detectLateFlips(snapshots, gameId, sources),
  ];
  return { anomalies: all, integrity: calculateIntegrity(gameId, all), clean: calculateIntegrity(gameId, all) >= 70 };
}
