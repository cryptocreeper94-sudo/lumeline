/**
 * LumeLine — ML Consensus Engine
 * Compiled from consensus.lume
 * Weighted ensemble with tier multipliers, confidence calculation,
 * house lean bias, and optional GPT-4 reasoning.
 */

import { getTierWeight } from './scoring.js';

const CONFIDENCE_THRESHOLD = 60;
const MIN_SOURCES = 3;

export function calculateWeightedVotes(gameId, snapshots, sources) {
  let homeWeight = 0, awayWeight = 0, totalWeight = 0, voterCount = 0;

  for (const source of sources) {
    const snaps = snapshots
      .filter(s => s.game_id === gameId && s.source_id === source.id && s.market === 'spread')
      .sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));

    if (snaps.length) {
      const latest = snaps[snaps.length - 1];
      const w = getTierWeight(source.tier) * ((source.accuracy_30d || 50) / 100);

      if (latest.line < 0) homeWeight += w;
      if (latest.line > 0) awayWeight += w;
      totalWeight += w;
      voterCount++;
    }
  }
  return { homeWeight, awayWeight, totalWeight, voterCount };
}

export function calculateAlignment(votes) {
  if (!votes.totalWeight) return 0;
  return Math.round((Math.max(votes.homeWeight, votes.awayWeight) / votes.totalWeight) * 100);
}

export function calculateConfidence(alignment, integrity, voterCount) {
  const integrityFactor = integrity / 100;
  const voterFactor = Math.min(voterCount / 10, 1.0);
  return Math.min(Math.round(alignment * integrityFactor * voterFactor), 99);
}

export function generateConsensus(game, snapshots, sources, anomalies) {
  const gameAnomalies = anomalies.filter(a => a.game_id === game.id);
  const votes = calculateWeightedVotes(game.id, snapshots, sources);

  if (votes.voterCount < MIN_SOURCES) {
    return {
      game_id: game.id,
      home_likelihood: 50, away_likelihood: 50,
      confidence: 0, alignment: 0,
      integrity: game.integrity_score || 100,
      house_lean: true,
      reasoning: `Insufficient data — fewer than ${MIN_SOURCES} sources available`,
      sources_agree: 0, sources_disagree: 0,
      generated_at: new Date().toISOString()
    };
  }

  const alignment = calculateAlignment(votes);
  const integrity = game.integrity_score || 100;
  const confidence = calculateConfidence(alignment, integrity, votes.voterCount);
  const houseLean = confidence < CONFIDENCE_THRESHOLD || integrity < 50;

  let homeLikelihood = votes.totalWeight
    ? Math.round((votes.homeWeight / votes.totalWeight) * 100) : 50;
  let awayLikelihood = 100 - homeLikelihood;

  // House lean pulls toward 50/50
  if (houseLean) {
    homeLikelihood = Math.round((homeLikelihood + 50) / 2);
    awayLikelihood = 100 - homeLikelihood;
  }

  const direction = votes.awayWeight > votes.homeWeight ? 'away' : 'home';
  const agreeCount = Math.round(votes.voterCount * alignment / 100);

  return {
    game_id: game.id,
    home_likelihood: homeLikelihood,
    away_likelihood: awayLikelihood,
    confidence, alignment, integrity,
    house_lean: houseLean,
    reasoning: houseLean
      ? `Low confidence (${confidence}%) — deferring to house line. ${gameAnomalies.length} anomaly flags.`
      : `${alignment}% source alignment favoring ${direction}. ${votes.voterCount} sources voted. Integrity: ${integrity}/100.`,
    sources_agree: agreeCount,
    sources_disagree: votes.voterCount - agreeCount,
    generated_at: new Date().toISOString()
  };
}

export function generateAllConsensus(games, snapshots, sources, anomalies) {
  return games.map(g => generateConsensus(g, snapshots, sources, anomalies));
}
