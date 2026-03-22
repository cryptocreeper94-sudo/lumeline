import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.log('⚠️  No DATABASE_URL set — skipping database init');
    process.exit(0);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  try {
    console.log('🔧 Initializing LumeLine database...');
    await pool.query(schema);
    console.log('✅ Database initialized successfully');

    // Verify tables
    const { rows } = await pool.query(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public' AND tablename IN ('sources','games','odds_snapshots','anomalies','consensus','picks','ingestion_log')
      ORDER BY tablename
    `);
    console.log(`📊 Tables created: ${rows.map(r => r.tablename).join(', ')}`);

    // Verify seed data
    const { rows: sources } = await pool.query('SELECT COUNT(*) FROM sources');
    console.log(`👥 Sources seeded: ${sources[0].count}`);
  } catch (err) {
    // If tables already exist, that's fine (ON CONFLICT handles seeds)
    if (err.message.includes('already exists')) {
      console.log('ℹ️  Tables already exist — skipping creation');
    } else {
      console.error('❌ Database init failed:', err.message);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

initDb();
