/**
 * LumeLine — ML Consensus Engine v0.2.0
 * Weighted ensemble with:
 *   - Line movement delta scoring (replaces direction-only voting)
 *   - CLV + consistency in weight formula
 *   - Temporal decay weighting
 *   - Anomaly type modulation (not just counting)
 *   - Confidence bands (range, not single number)
 *   - Gradient house lean (not binary 50/50 pull)
 *   - Multi-market fusion (spread + moneyline cross-check)
 *   - Sport-specific calibration
 *   - Optional GPT reasoning for high-confidence picks
 */

import { getTierWeight } from './scoring.js';
import { getSportConfig } from './sport-config.js';

const MODEL_VERSION = 'v0.2.0';

// ─── Temporal Decay (P6) ───
export function getTemporalWeight(timeToGame) {
  if (timeToGame === null || timeToGame === undefined) return 1.0;
  if (timeToGame > 2880) return 0.4;   // 48+ hours out
  if (timeToGame > 1440) return 0.6;   // 24–48 hours
  if (timeToGame > 360)  return 0.8;   // 6–24 hours
  if (timeToGame > 120)  return 1.0;   // 2–6 hours (baseline)
  if (timeToGame > 30)   return 1.5;   // 30min–2hr (sharp window)
  return 2.0;                           // Final 30 minutes (max signal)
}

// ─── Line Movement Delta Scoring (P5) with CLV (P1) + Temporal (P6) ───
export function calculateWeightedVotes(gameId, snapshots, sources) {
  let homeWeight = 0, awayWeight = 0, totalWeight = 0, voterCount = 0;

  for (const source of sources) {
    const snaps = snapshots
      .filter(s => s.game_id === gameId && s.source_id === source.id && s.market === 'spread')
      .sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));

    if (!snaps.length) continue;

    // P1: CLV + consistency factored into base weight
    const accuracyFactor = (source.accuracy_30d || 50) / 100;
    const clvFactor = 1 + Math.min((source.clv_score || 0) / 20, 0.75);
    const consistencyFactor = (source.consistency || 50) / 100;
    const baseWeight = getTierWeight(source.tier) * accuracyFactor * clvFactor * consistencyFactor;

    // P6: Temporal weighting from latest snapshot
    const latestSnap = snaps[snaps.length - 1];
    const temporalMult = getTemporalWeight(latestSnap.time_to_game);

    if (snaps.length < 2) {
      // Single snapshot — use direction but with reduced weight (40%)
      const w = baseWeight * 0.4 * temporalMult;
      if (latestSnap.line < 0) homeWeight += w;
      if (latestSnap.line > 0) awayWeight += w;
      totalWeight += w;
      voterCount++;
      continue;
    }

    // P5: Line movement delta scoring
    const opening = snaps[0];
    const latest = snaps[snaps.length - 1];
    const delta = latest.line - opening.line;

    if (Math.abs(delta) < 0.5) {
      // No meaningful movement — 50% weight
      const w = baseWeight * 0.5 * temporalMult;
      if (latest.line < 0) homeWeight += w;
      else awayWeight += w;
      totalWeight += w;
      voterCount++;
      continue;
    }

    // Movement detected — weight by delta magnitude (capped at 3.5 for outlier control)
    const deltaMultiplier = Math.min(Math.abs(delta) / 3.5, 1.0);
    const clvBonus = Math.min((source.clv_score || 0) / 10, 0.5);
    const finalWeight = baseWeight * (1 + deltaMultiplier + clvBonus) * temporalMult;

    // Direction of movement determines the vote
    if (delta < 0) homeWeight += finalWeight;   // line moved toward home = sharp on home
    else awayWeight += finalWeight;              // line moved toward away = sharp on away

    totalWeight += finalWeight;
    voterCount++;
  }

  return { homeWeight, awayWeight, totalWeight, voterCount };
}

// ─── Alignment (unchanged) ───
export function calculateAlignment(votes) {
  if (!votes.totalWeight) return 0;
  return Math.round((Math.max(votes.homeWeight, votes.awayWeight) / votes.totalWeight) * 100);
}

// ─── Base Confidence (unchanged) ───
export function calculateConfidence(alignment, integrity, voterCount) {
  const integrityFactor = integrity / 100;
  const voterFactor = Math.min(voterCount / 10, 1.0);
  return Math.min(Math.round(alignment * integrityFactor * voterFactor), 99);
}

// ─── Confidence Bands (P3) ───
export function calculateConfidenceBand(confidence, voterCount, anomalyCount) {
  const baseWidth = Math.max(20 - voterCount, 4);
  const anomalyNoise = anomalyCount > 0 ? 3 : 0;
  const halfWidth = Math.round((baseWidth / 2) + anomalyNoise);

  return {
    confidence,
    confidence_low: Math.max(confidence - halfWidth, 0),
    confidence_high: Math.min(confidence + halfWidth, 99),
    confidence_label: confidence >= 75 ? 'high' : confidence >= 55 ? 'medium' : 'low'
  };
}

// ─── Anomaly Type Modulation (P2) ───
function getAnomalyImpact(anomaly) {
  const severityMultiplier = { critical: 1.5, high: 1.0, medium: 0.6, low: 0.3 }[anomaly.severity] || 0.5;
  const impacts = {
    sync_move: 12, reverse_steam: 18, house_divergence: 6,
    late_flip: 22, outlier_consensus: -5
  };
  return Math.round((impacts[anomaly.signal_type] || 0) * severityMultiplier);
}

export function getAnomalyModifier(anomalies) {
  let confidenceBoost = 0;
  let directionSignal = null;

  for (const anomaly of anomalies) {
    const severityMultiplier = { critical: 1.5, high: 1.0, medium: 0.6, low: 0.3 }[anomaly.severity] || 0.5;

    switch (anomaly.signal_type) {
      case 'sync_move':
        confidenceBoost += 12 * severityMultiplier;
        break;
      case 'reverse_steam':
        confidenceBoost += 18 * severityMultiplier;
        if (anomaly.metadata?.sharp_side) directionSignal = anomaly.metadata.sharp_side;
        break;
      case 'house_divergence':
        confidenceBoost += 6 * severityMultiplier;
        break;
      case 'late_flip':
        confidenceBoost += 22 * severityMultiplier;
        if (anomaly.metadata?.flip_direction) directionSignal = anomaly.metadata.flip_direction;
        break;
      case 'outlier_consensus':
        confidenceBoost -= 5 * severityMultiplier;
        break;
    }
  }

  return {
    confidenceBoost: Math.min(confidenceBoost, 30),
    directionSignal
  };
}

// ─── Multi-Market Fusion (P8) ───
export function getMarketFusionSignal(gameId, snapshots) {
  const spreadSnaps = snapshots.filter(s => s.game_id === gameId && s.market === 'spread');
  const mlSnaps = snapshots.filter(s => s.game_id === gameId && s.market === 'moneyline');

  if (!spreadSnaps.length || !mlSnaps.length) return { divergence: 0, direction: null };

  const avgSpreadLine = spreadSnaps.reduce((sum, s) => sum + (s.line || 0), 0) / spreadSnaps.length;
  const avgHomeOdds = mlSnaps.reduce((sum, s) => sum + (s.odds_home || -110), 0) / mlSnaps.length;

  // Convert American odds to implied probability
  const homeImplied = avgHomeOdds < 0
    ? Math.abs(avgHomeOdds) / (Math.abs(avgHomeOdds) + 100) * 100
    : 100 / (avgHomeOdds + 100) * 100;

  // Spread-implied probability (rough linear approximation)
  const spreadImplied = 50 + (Math.abs(avgSpreadLine) * 3);
  const spreadFavorHome = avgSpreadLine < 0;
  const divergence = Math.abs(homeImplied - (spreadFavorHome ? spreadImplied : 100 - spreadImplied));

  return {
    divergence,
    direction: divergence > 10
      ? (homeImplied > spreadImplied ? 'moneyline_favors_home' : 'moneyline_favors_away')
      : null,
    homeImplied: Math.round(homeImplied * 10) / 10,
    awayImplied: Math.round((100 - homeImplied) * 10) / 10,
    spreadImplied: Math.round(spreadImplied * 10) / 10
  };
}

// ─── GPT Reasoning (P11) ───
export async function generateGPTReasoning(consensusResult, game, anomalies, sportConfig) {
  if (!process.env.OPENAI_API_KEY) return null;
  if (consensusResult.confidence < 55) return null;

  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `You are a sharp sports betting analyst. Explain this consensus prediction concisely in 2-3 sentences. Write for a casual bettor, not an expert. Do not use jargon.

Game: ${game.away_team} @ ${game.home_team} (${game.sport?.toUpperCase() || 'SPORT'}, ${new Date(game.start_time).toLocaleDateString()})
Consensus: ${consensusResult.home_likelihood}% home / ${consensusResult.away_likelihood}% away
Confidence: ${consensusResult.confidence}%
Source alignment: ${consensusResult.alignment}% of sources agree
Active anomalies: ${anomalies.map(a => a.signal_type).join(', ') || 'none'}
House lean active: ${consensusResult.house_lean}

Write a plain-English explanation of what the data is saying and why.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
      temperature: 0.3
    });
    return completion.choices[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

// ─── Main Consensus Generator (P1-P8, P11 combined) ───
export async function generateConsensus(game, snapshots, sources, anomalies) {
  const sportConfig = getSportConfig(game.sport);
  const gameAnomalies = anomalies.filter(a => a.game_id === game.id);
  const votes = calculateWeightedVotes(game.id, snapshots, sources);

  if (votes.voterCount < sportConfig.minSources) {
    return {
      game_id: game.id,
      home_likelihood: 50, away_likelihood: 50,
      confidence: 0, confidence_low: 0, confidence_high: 0, confidence_label: 'low',
      alignment: 0, integrity: game.integrity_score || 100,
      house_lean: true, house_lean_strength: 100,
      market_divergence: 0,
      reasoning: `Insufficient data — fewer than ${sportConfig.minSources} sources available for ${game.sport?.toUpperCase() || 'this sport'}`,
      technical_reasoning: '',
      sources_agree: 0, sources_disagree: 0,
      anomaly_flags: gameAnomalies.map(a => ({ type: a.signal_type, severity: a.severity })),
      model_version: MODEL_VERSION,
      generated_at: new Date().toISOString()
    };
  }

  const alignment = calculateAlignment(votes);
  const integrity = game.integrity_score || 100;
  const baseConfidence = calculateConfidence(alignment, integrity, votes.voterCount);

  // P2: Anomaly modulation
  const anomalyResult = getAnomalyModifier(gameAnomalies);
  const confidence = Math.min(baseConfidence + anomalyResult.confidenceBoost, 99);

  // P3: Confidence bands
  const confidenceBand = calculateConfidenceBand(confidence, votes.voterCount, gameAnomalies.length);

  // P4: Gradient house lean (replaces binary switch)
  const houseLean = confidence < 50 || integrity < 40;
  const houseLeanStrength = houseLean ? Math.max(0, (50 - confidence) / 50) : 0;

  let homeLikelihood = votes.totalWeight
    ? Math.round((votes.homeWeight / votes.totalWeight) * 100) : 50;
  let awayLikelihood = 100 - homeLikelihood;

  // Gradient pull (instead of blunt 50/50 average)
  if (houseLean && houseLeanStrength > 0) {
    homeLikelihood = Math.round(homeLikelihood * (1 - houseLeanStrength) + 50 * houseLeanStrength);
    awayLikelihood = 100 - homeLikelihood;
  }

  // Apply anomaly direction signal
  if (anomalyResult.directionSignal === 'home') {
    homeLikelihood = Math.min(homeLikelihood + 5, 95);
    awayLikelihood = 100 - homeLikelihood;
  } else if (anomalyResult.directionSignal === 'away') {
    awayLikelihood = Math.min(awayLikelihood + 5, 95);
    homeLikelihood = 100 - awayLikelihood;
  }

  // P8: Multi-market fusion
  const marketFusion = getMarketFusionSignal(game.id, snapshots);
  const adjustedConfidence = marketFusion.divergence > 10
    ? Math.max(confidence - 10, 0)
    : marketFusion.divergence > 5
      ? Math.max(confidence - 5, 0)
      : confidence;

  const direction = awayLikelihood > homeLikelihood ? 'away' : 'home';
  const agreeCount = Math.round(votes.voterCount * alignment / 100);

  // Build reasoning
  const anomalyText = gameAnomalies.length
    ? `${gameAnomalies.length} signal(s) detected: ${gameAnomalies.map(a => a.signal_type.replace(/_/g, ' ')).join(', ')}.`
    : '';
  const fusionText = marketFusion.divergence > 10
    ? `Market conflict: moneyline implies ${marketFusion.homeImplied}% home but spread suggests ${marketFusion.spreadImplied}%.`
    : '';

  const baseReasoning = houseLean
    ? `Low confidence (${adjustedConfidence}%) — partial house lean applied. ${anomalyText} ${fusionText}`.trim()
    : `${alignment}% source alignment favoring ${direction} (${votes.voterCount} sources, ${agreeCount} in agreement). ${anomalyText} ${fusionText}`.trim();

  // P11: Optional GPT reasoning for high-confidence picks
  const gptReasoning = await generateGPTReasoning(
    { ...confidenceBand, home_likelihood: homeLikelihood, away_likelihood: awayLikelihood, house_lean: houseLean, alignment },
    game, gameAnomalies, sportConfig
  );

  return {
    game_id: game.id,
    home_likelihood: homeLikelihood,
    away_likelihood: awayLikelihood,
    confidence: adjustedConfidence,
    confidence_low: confidenceBand.confidence_low,
    confidence_high: confidenceBand.confidence_high,
    confidence_label: confidenceBand.confidence_label,
    alignment, integrity,
    house_lean: houseLean,
    house_lean_strength: Math.round(houseLeanStrength * 100),
    market_divergence: marketFusion.divergence > 5 ? Math.round(marketFusion.divergence) : 0,
    reasoning: gptReasoning || baseReasoning,
    technical_reasoning: baseReasoning,
    sources_agree: agreeCount,
    sources_disagree: votes.voterCount - agreeCount,
    anomaly_flags: gameAnomalies.map(a => ({
      type: a.signal_type,
      severity: a.severity,
      confidence_impact: getAnomalyImpact(a)
    })),
    model_version: MODEL_VERSION,
    generated_at: new Date().toISOString()
  };
}

// Updated: now async because of GPT reasoning
export async function generateAllConsensus(games, snapshots, sources, anomalies) {
  const results = [];
  for (const g of games) {
    results.push(await generateConsensus(g, snapshots, sources, anomalies));
  }
  return results;
}
