-- ModelZero Analytics Database Migration
-- Classification System V2
--
-- This migration prepares the database for the new systematic classification approach.

BEGIN;

-- Step 0: Drop views that depend on bot_classification column
DROP VIEW IF EXISTS v_bot_summary CASCADE;
DROP VIEW IF EXISTS v_daily_stats CASCADE;

-- Step 1: Increase bot_classification column size to accommodate new category names
-- Old categories: 'official_ai', 'stealth_ai', 'web_crawler', 'human' (max 12 chars)
-- New categories: 'attack_wordpress_scanner' (24 chars - longest)
ALTER TABLE events ALTER COLUMN bot_classification TYPE VARCHAR(30);

-- Step 2: Create index on bot_classification for better query performance
CREATE INDEX IF NOT EXISTS idx_events_bot_classification ON events(bot_classification);

-- Step 3: Create index on is_bot for filtering
CREATE INDEX IF NOT EXISTS idx_events_is_bot ON events(is_bot);

-- Step 4: Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_events_timestamp_classification
ON events(timestamp DESC, bot_classification);

-- Step 5: Add migration tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Record this migration
INSERT INTO schema_migrations (version, description)
VALUES (2, 'Add V2 classification categories and indexes')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Display current bot_classification distribution
SELECT
  bot_classification,
  COUNT(*) as count,
  ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 2) as percentage
FROM events
GROUP BY bot_classification
ORDER BY count DESC;

-- Display statistics
SELECT
  'Total Events' as metric,
  COUNT(*)::text as value
FROM events
UNION ALL
SELECT
  'Human Events',
  COUNT(*)::text
FROM events WHERE bot_classification = 'human'
UNION ALL
SELECT
  'Bot Events',
  COUNT(*)::text
FROM events WHERE is_bot = true
UNION ALL
SELECT
  'Events Missing Sec-Fetch',
  COUNT(*)::text
FROM events WHERE has_sec_fetch_headers = false;
