import dotenv from 'dotenv';
dotenv.config();
import db from './db.js';

const API_KEY = process.env.ODDS_API_KEY;
const API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4';
const SPORTS = (process.env.SUPPORTED_SPORTS || 'americanfootball_nfl,basketball_nba').split(',');

// ═══ Fetch upcoming games + odds from The Odds API ═══
async function fetchOdds(sport) {
  const url = `${API_BASE}/sports/${sport}/odds/?apiKey=${API_KEY}&regions=us&markets=spreads,h2h,totals&oddsFormat=american`;
  console.log(`📡 Fetching odds for ${sport}...`);
  
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Odds API ${res.status}: ${res.statusText}`);
  
  const remaining = res.headers.get('x-requests-remaining');
  const used = res.headers.get('x-requests-used');
  console.log(`   API quota: ${remaining} remaining / ${used} used`);
  
  return res.json();
}

// ═══ Map sport key to our sport/league ═══
function mapSport(apiSport) {
  const map = {
    'americanfootball_nfl': { sport: 'NFL', league: 'NFL' },
    'basketball_nba': { sport: 'NBA', league: 'NBA' },
  };
  return map[apiSport] || { sport: apiSport, league: apiSport };
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
      const marketType = market.key === 'spreads' ? 'spread' : market.key === 'h2h' ? 'moneyline' : 'total';
      
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

// ═══ Run Full Ingestion Cycle ═══
export async function runIngestion() {
  console.log('\n═══════════════════════════════════════');
  console.log('  LumeLine Ingestion Cycle Starting...');
  console.log('═══════════════════════════════════════\n');
  
  const sources = await db.getSources();
  let totalSnapshots = 0;
  let totalGames = 0;
  
  for (const sport of SPORTS) {
    const start = Date.now();
    
    try {
      const apiGames = await fetchOdds(sport);
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
  
  console.log(`\n✦ Ingestion complete: ${totalGames} games, ${totalSnapshots} snapshots\n`);
  return { totalGames, totalSnapshots };
}

export default { runIngestion };
