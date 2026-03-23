import dotenv from 'dotenv';
dotenv.config();
import db from './db.js';

const API_KEY = process.env.ODDS_API_KEY;
const API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4';

// ═══ Sport Tiers (manages polling frequency to stay under 500 req/day) ═══
// ACTIVE SPORTS — Late March 2026
// Core (daily games): NBA + NHL + NCAAB → 3 × 48 = 144 req/day
// Secondary (in-season): EPL, La Liga, MLS, MMA, ATP → 5 × 24 = 120 req/day
// Total: ~264 req/day (well under 500)
// NOTE: Adjust around Thursday for NCAAB Sweet 16 (bump interval to 10 min)
const CORE_SPORTS = (process.env.CORE_SPORTS || 'basketball_nba,icehockey_nhl,basketball_ncaab').split(',');
const SECONDARY_SPORTS = (process.env.SECONDARY_SPORTS || 'soccer_epl,soccer_spain_la_liga,soccer_usa_mls,mma_mixed_martial_arts').split(',').filter(s => s);
const ALL_SPORTS = [...CORE_SPORTS, ...SECONDARY_SPORTS];

// ═══ Fetch upcoming games + odds from The Odds API ═══
async function fetchOdds(sport) {
  const url = `${API_BASE}/sports/${sport}/odds/?apiKey=${API_KEY}&regions=us&markets=spreads,h2h,totals&oddsFormat=american`;
  console.log(`📡 Fetching odds for ${sport}...`);
  
  const res = await fetch(url);
  if (!res.ok) {
    // 404 typically means sport not in season — not an error
    if (res.status === 404) {
      console.log(`   ⏸️  ${sport} — not in season or no games available`);
      return [];
    }
    throw new Error(`Odds API ${res.status}: ${res.statusText}`);
  }
  
  const remaining = res.headers.get('x-requests-remaining');
  const used = res.headers.get('x-requests-used');
  console.log(`   API quota: ${remaining} remaining / ${used} used`);
  
  // If running low on quota, skip secondary sports
  if (parseInt(remaining) < 50) {
    console.log('   ⚠️  API quota low — will skip secondary sports');
  }
  
  return res.json();
}

// ═══ Map sport key to our sport/league ═══
function mapSport(apiSport) {
  const map = {
    'americanfootball_nfl': { sport: 'NFL', league: 'NFL' },
    'americanfootball_ncaaf': { sport: 'NCAAF', league: 'NCAAF' },
    'basketball_nba': { sport: 'NBA', league: 'NBA' },
    'basketball_ncaab': { sport: 'NCAAB', league: 'NCAAB' },
    'basketball_wnba': { sport: 'WNBA', league: 'WNBA' },
    'baseball_mlb': { sport: 'MLB', league: 'MLB' },
    'icehockey_nhl': { sport: 'NHL', league: 'NHL' },
    'soccer_epl': { sport: 'EPL', league: 'EPL' },
    'soccer_spain_la_liga': { sport: 'La Liga', league: 'La Liga' },
    'soccer_usa_mls': { sport: 'MLS', league: 'MLS' },
    'mma_mixed_martial_arts': { sport: 'UFC', league: 'UFC' },
    'tennis_atp': { sport: 'Tennis', league: 'ATP' },
    'tennis_wta': { sport: 'Tennis', league: 'WTA' },
    'golf_masters_tournament_winner': { sport: 'Golf', league: 'PGA' },
    'golf_pga_championship': { sport: 'Golf', league: 'PGA' },
    'cricket_ipl': { sport: 'Cricket', league: 'IPL' },
    'cricket_test_match': { sport: 'Cricket', league: 'Test' },
    'rugbyleague_nrl': { sport: 'Rugby', league: 'NRL' },
    'americanfootball_nfl_preseason': { sport: 'NFL', league: 'NFL Preseason' },
  };
  return map[apiSport] || { sport: apiSport.split('_').pop().toUpperCase(), league: apiSport };
}

// ═══ Process a single game from the API response ═══
async function processGame(apiGame, sources) {
  const { sport, league } = mapSport(apiGame.sport_key);
  
  // Upsert the game
  const game = await db.upsertGame({
    external_id: apiGame.id,
    sport,
    league,
    home_team: apiGame.home_team,
    away_team: apiGame.away_team,
    start_time: apiGame.commence_time,
    status: 'upcoming'
  });
  
  let snapshotCount = 0;
  const minutesToGame = Math.round((new Date(apiGame.commence_time) - new Date()) / 60000);
  
  // Process each bookmaker's odds
  for (const bookmaker of (apiGame.bookmakers || [])) {
    const source = sources.find(s => s.slug === bookmaker.key);
    if (!source) continue;
    
    for (const market of (bookmaker.markets || [])) {
      if (market.key === 'spreads' && market.outcomes?.length >= 2) {
        const homeOutcome = market.outcomes.find(o => o.name === apiGame.home_team);
        const awayOutcome = market.outcomes.find(o => o.name === apiGame.away_team);
        
        if (homeOutcome) {
          await db.insertSnapshot({
            game_id: game.id,
            source_id: source.id,
            market: 'spread',
            line: homeOutcome.point,
            odds_home: homeOutcome.price,
            odds_away: awayOutcome?.price,
            time_to_game: minutesToGame
          });
          snapshotCount++;
        }
      }
      
      if (market.key === 'h2h' && market.outcomes?.length >= 2) {
        const homeOutcome = market.outcomes.find(o => o.name === apiGame.home_team);
        const awayOutcome = market.outcomes.find(o => o.name === apiGame.away_team);
        
        if (homeOutcome) {
          await db.insertSnapshot({
            game_id: game.id,
            source_id: source.id,
            market: 'moneyline',
            odds_home: homeOutcome.price,
            odds_away: awayOutcome?.price,
            time_to_game: minutesToGame
          });
          snapshotCount++;
        }
      }
      
      if (market.key === 'totals' && market.outcomes?.length >= 2) {
        const overOutcome = market.outcomes.find(o => o.name === 'Over');
        if (overOutcome) {
          await db.insertSnapshot({
            game_id: game.id,
            source_id: source.id,
            market: 'total',
            over_under: overOutcome.point,
            odds_home: overOutcome.price,
            odds_away: market.outcomes.find(o => o.name === 'Under')?.price,
            time_to_game: minutesToGame
          });
          snapshotCount++;
        }
      }
    }
  }
  
  return { game, snapshotCount };
}

// ═══ Run Ingestion for a set of sports ═══
async function ingestSports(sportKeys, sources) {
  let totalSnapshots = 0;
  let totalGames = 0;

  for (const sport of sportKeys) {
    const start = Date.now();
    try {
      const apiGames = await fetchOdds(sport);
      if (!apiGames || apiGames.length === 0) {
        console.log(`   ⏸️  ${sport} — no games returned`);
        continue;
      }
      console.log(`   Found ${apiGames.length} games for ${sport}`);
      
      for (const apiGame of apiGames) {
        const { game, snapshotCount } = await processGame(apiGame, sources);
        totalSnapshots += snapshotCount;
        totalGames++;
        console.log(`   ✅ ${game.away_team} @ ${game.home_team} — ${snapshotCount} snapshots`);
      }
      
      await db.logIngestion({
        sport: mapSport(sport).sport,
        source_count: sources.length,
        snapshot_count: totalSnapshots,
        anomaly_count: 0,
        duration_ms: Date.now() - start,
        status: 'success'
      });
    } catch (err) {
      console.error(`   ❌ Error fetching ${sport}:`, err.message);
      await db.logIngestion({
        sport: mapSport(sport).sport,
        source_count: 0,
        snapshot_count: 0,
        anomaly_count: 0,
        duration_ms: Date.now() - start,
        status: 'error',
        error: err.message
      });
    }
  }

  return { totalGames, totalSnapshots };
}

// ═══ Run Full Ingestion Cycle (Core sports) ═══
export async function runIngestion() {
  console.log('\n═══════════════════════════════════════');
  console.log('  LumeLine Core Ingestion Cycle');
  console.log('═══════════════════════════════════════\n');
  
  const sources = await db.getSources();
  const result = await ingestSports(CORE_SPORTS, sources);
  console.log(`\n✦ Core ingestion complete: ${result.totalGames} games, ${result.totalSnapshots} snapshots\n`);
  return result;
}

// ═══ Secondary Ingestion (runs at lower frequency) ═══
export async function runSecondaryIngestion() {
  console.log('\n═══════════════════════════════════════');
  console.log('  LumeLine Secondary Ingestion Cycle');
  console.log('═══════════════════════════════════════\n');
  
  const sources = await db.getSources();
  const result = await ingestSports(SECONDARY_SPORTS, sources);
  console.log(`\n✦ Secondary ingestion complete: ${result.totalGames} games, ${result.totalSnapshots} snapshots\n`);
  return result;
}

// ═══ Run ALL sports (manual trigger only) ═══
export async function runFullIngestion() {
  console.log('\n═══════════════════════════════════════');
  console.log('  LumeLine FULL Ingestion (All Sports)');
  console.log('═══════════════════════════════════════\n');
  
  const sources = await db.getSources();
  const result = await ingestSports(ALL_SPORTS, sources);
  console.log(`\n✦ Full ingestion complete: ${result.totalGames} games, ${result.totalSnapshots} snapshots\n`);
  return result;
}

export default { runIngestion, runSecondaryIngestion, runFullIngestion };
