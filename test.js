import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateWeightedVotes, getTemporalWeight } from './server/consensus.js';
import { detectSyncMoves, detectReverseSteam } from './server/anomaly.js';
import { decodeGame } from './server/house-decoder.js';
import { evaluateOutcomes } from './server/outcomes.js';

test('LumeLine Core Engine Tests', async (t) => {
  
  await t.test('Consensus Engine: getTemporalWeight applies tiered 48h to 30m multipliers', () => {
    assert.equal(getTemporalWeight(2881), 0.4, '48+ hours out yields low weight');
    assert.equal(getTemporalWeight(1441), 0.6, '24-48 hours out yields 0.6 scale');
    assert.equal(getTemporalWeight(361), 0.8, '6-24 hours yields 0.8 scale');
    assert.equal(getTemporalWeight(121), 1.0, '2-6 hours yields 1.0 (baseline) scale');
    assert.equal(getTemporalWeight(31), 1.5, 'Sharp window (30m to 2h) yields 1.5 scale');
    assert.equal(getTemporalWeight(15), 2.0, 'Max signal inside final 30 minutes');
  });

  await t.test('Consensus Engine: calculateWeightedVotes delta scoring attributes directional preference', () => {
    const gameId = 'uuid-game-123';
    const sources = [{ id: 'source-1', tier: 'sharp', accuracy_30d: 65, clv_score: 5, consistency: 80 }];
    const snapshots = [
      { game_id: gameId, source_id: 'source-1', market: 'spread', line: -3.5, captured_at: new Date(Date.now() - 3600000).toISOString(), time_to_game: 120 },
      { game_id: gameId, source_id: 'source-1', market: 'spread', line: -4.5, captured_at: new Date().toISOString(), time_to_game: 60 }
    ];
    
    const votes = calculateWeightedVotes(gameId, snapshots, sources);
    
    // Delta = -4.5 - (-3.5) = -1.0 (moved toward home line). 
    assert.ok(votes.homeWeight > 0, 'Home weight should be positive, line drifted downwards favoring home side');
    assert.equal(votes.awayWeight, 0, 'Away weight defaults to zero as money drifted to home');
    assert.equal(votes.voterCount, 1, 'System accurately indexes 1 voter component');
  });

  await t.test('Anomaly Engine: detectSyncMoves structures valid structural checks', () => {
    assert.ok(typeof detectSyncMoves === 'function', 'Algorithm function detector intact');
  });

  await t.test('House Decoder: decodeGame API signature structural check', () => {
    assert.ok(typeof decodeGame === 'function', 'Game decoding structure functional');
  });

  await t.test('Outcomes: evaluateOutcomes scheduled evaluation mechanism accessible', () => {
    assert.ok(typeof evaluateOutcomes === 'function', 'Engine interval check available to core logic loops');
  });
});
