-- ═══════════════════════════════════════════════════════════
--  LumeLine — Migration: Rename "Mathew" to "King Capper"
--  Run: psql $DATABASE_URL -f db/migration_rename_mathew.sql
-- ═══════════════════════════════════════════════════════════

UPDATE sources 
SET name = 'King Capper', 
    slug = 'king-capper' 
WHERE slug = 'mathew';
