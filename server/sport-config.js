/**
 * LumeLine — Sport-Specific Calibration Config
 * Different sports have different line efficiency and movement patterns.
 * NFL lines are the most efficient; late MLB moves are very predictive due to pitching changes.
 */

export const SPORT_CONFIG = {
  nfl: {
    sharpThreshold: 62,
    minSources: 4,
    keyNumbers: [3, 7, 10],
    lateWeightMultiplier: 2.5,
  },
  nba: {
    sharpThreshold: 58,
    minSources: 3,
    keyNumbers: [],
    lateWeightMultiplier: 1.8,
  },
  mlb: {
    sharpThreshold: 55,
    minSources: 3,
    keyNumbers: [],
    lateWeightMultiplier: 2.0,
  },
  nhl: {
    sharpThreshold: 55,
    minSources: 3,
    keyNumbers: [],
    lateWeightMultiplier: 1.5,
  },
  default: {
    sharpThreshold: 58,
    minSources: 3,
    keyNumbers: [],
    lateWeightMultiplier: 1.5,
  }
};

export function getSportConfig(sport) {
  return SPORT_CONFIG[sport?.toLowerCase()] || SPORT_CONFIG.default;
}
