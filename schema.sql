-- Vivocare 3DS Analytics Database Schema
-- PostgreSQL 14+
-- Created: 2025-11-06

-- Drop existing tables if re-creating
DROP TABLE IF EXISTS behavior_patterns CASCADE;
DROP TABLE IF EXISTS journeys CASCADE;
DROP TABLE IF EXISTS ingestion_state CASCADE;
DROP TABLE IF EXISTS events CASCADE;

-- ============================================================================
-- Main Events Table
-- ============================================================================

CREATE TABLE events (
  -- Primary Key
  id BIGSERIAL PRIMARY KEY,

  -- Timing
  timestamp TIMESTAMPTZ NOT NULL,
  duration DOUBLE PRECISION NOT NULL,

  -- Client Info (from Cloudflare headers)
  client_ip INET NOT NULL,        -- Cf-Connecting-Ip (REAL client IP)
  country CHAR(2),                -- Cf-Ipcountry
  city VARCHAR(100),              -- MaxMind GeoLite2 lookup
  latitude FLOAT,                 -- MaxMind GeoLite2 lookup
  longitude FLOAT,                -- MaxMind GeoLite2 lookup
  cf_ray TEXT,                    -- Cloudflare unique request ID

  -- Network Analysis
  subnet CIDR,                    -- /24 subnet for clustering
  asn INTEGER,                    -- Autonomous System Number
  asn_org VARCHAR(255),           -- ASN organization name
  datacenter_provider VARCHAR(20), -- 'azure', 'gcp', 'aws', null

  -- Request
  site VARCHAR(100) NOT NULL,     -- Domain (thaibelle.com, etc.)
  method VARCHAR(10) NOT NULL,    -- GET, POST, HEAD
  path TEXT NOT NULL,             -- /posts/article.html
  query_string TEXT,              -- id=123&ref=google

  -- Response
  status SMALLINT NOT NULL,       -- HTTP status code
  response_size INTEGER,          -- Response bytes
  content_type VARCHAR(100),      -- MIME type

  -- User Agent
  user_agent TEXT,

  -- Bot Detection (pre-computed during ingestion)
  is_bot BOOLEAN DEFAULT FALSE,
  bot_classification VARCHAR(20), -- 'official_ai', 'stealth_ai', 'web_crawler', 'human', 'unknown'
  bot_name VARCHAR(50),           -- 'GPTBot', 'ClaudeBot', 'Azure-Stealth', etc.
  detection_level INTEGER,        -- 1=User-Agent, 2=Datacenter IP, 3=Behavioral

  -- Human Browser Signals
  referer TEXT,
  accept_language TEXT,
  has_sec_fetch_headers BOOLEAN,  -- Sec-Fetch-* presence
  has_client_hints BOOLEAN,       -- Sec-Ch-Ua-* presence
  is_mobile BOOLEAN,              -- Mobile device indicator

  -- Bot-Specific Headers
  bot_from_email VARCHAR(100),    -- Email from 'From' header
  openai_host_hash VARCHAR(50),   -- X-Openai-Host-Hash

  -- Security Flags
  has_cf_worker BOOLEAN DEFAULT FALSE,
  cf_worker_domain VARCHAR(255),  -- Cloudflare Worker domain
  is_exploit_attempt BOOLEAN DEFAULT FALSE,

  -- Raw Data (for future analysis)
  headers_json JSONB              -- Full request headers
);

-- Create indexes for performance
CREATE INDEX idx_timestamp ON events(timestamp DESC);
CREATE INDEX idx_site ON events(site);
CREATE INDEX idx_client_ip ON events(client_ip);
CREATE INDEX idx_bot_classification ON events(bot_classification);
CREATE INDEX idx_timestamp_site ON events(timestamp DESC, site);
CREATE INDEX idx_subnet ON events(subnet);
CREATE INDEX idx_asn ON events(asn);
CREATE INDEX idx_country ON events(country);
CREATE INDEX idx_city ON events(city);
CREATE INDEX idx_path ON events(path);
CREATE INDEX idx_content_type ON events(content_type);
CREATE INDEX idx_is_bot ON events(is_bot);
CREATE INDEX idx_bot_name ON events(bot_name);
CREATE INDEX idx_cf_ray ON events(cf_ray);

-- JSONB index for header queries
CREATE INDEX idx_headers_json ON events USING GIN (headers_json);

COMMENT ON TABLE events IS 'Main events table storing all HTTP requests with bot classification';
COMMENT ON COLUMN events.client_ip IS 'Real client IP from Cf-Connecting-Ip header (not Cloudflare edge IP)';
COMMENT ON COLUMN events.bot_classification IS 'official_ai|stealth_ai|web_crawler|human|unknown';
COMMENT ON COLUMN events.detection_level IS '1=User-Agent, 2=Datacenter IP, 3=Behavioral';

-- ============================================================================
-- Behavioral Patterns Table
-- ============================================================================

CREATE TABLE behavior_patterns (
  id SERIAL PRIMARY KEY,

  -- Detection info
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_ip INET NOT NULL,
  subnet CIDR,

  -- Pattern details
  pattern_type VARCHAR(50) NOT NULL, -- 'rapid_sequential', 'data_harvesting', 'cross_site_journey'
  confidence_score FLOAT NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),

  -- Evidence
  request_count INTEGER,
  time_span_seconds INTEGER,
  sites_visited TEXT[],
  paths_accessed TEXT[],

  -- Classification impact
  suggested_classification VARCHAR(20)
);

-- Indexes
CREATE INDEX idx_bp_detected_at ON behavior_patterns(detected_at DESC);
CREATE INDEX idx_bp_client_ip ON behavior_patterns(client_ip);
CREATE INDEX idx_bp_pattern_type ON behavior_patterns(pattern_type);
CREATE INDEX idx_bp_subnet ON behavior_patterns(subnet);

COMMENT ON TABLE behavior_patterns IS 'Detected behavioral patterns for Level 3 bot classification';
COMMENT ON COLUMN behavior_patterns.confidence_score IS 'Confidence level from 0.0 to 1.0';

-- ============================================================================
-- Cross-Site Journeys Table
-- ============================================================================

CREATE TABLE journeys (
  id SERIAL PRIMARY KEY,

  -- Identification
  subnet CIDR NOT NULL,
  client_ip INET,

  -- Journey timeline
  first_seen TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL,

  -- Funnel progression
  sites_visited TEXT[] NOT NULL,     -- ['veteransmemorycare.org', 'memorycareguide.org']
  funnel_stage INTEGER NOT NULL CHECK (funnel_stage >= 1 AND funnel_stage <= 3),
  completed_funnel BOOLEAN DEFAULT FALSE, -- Reached thaibelle.com?

  -- Volume
  total_requests INTEGER NOT NULL,
  unique_ips INTEGER NOT NULL,

  -- Classification
  bot_classification VARCHAR(20),
  bot_name VARCHAR(50)
);

-- Indexes
CREATE INDEX idx_j_subnet ON journeys(subnet);
CREATE INDEX idx_j_funnel_stage ON journeys(funnel_stage);
CREATE INDEX idx_j_first_seen ON journeys(first_seen DESC);
CREATE INDEX idx_j_completed_funnel ON journeys(completed_funnel);
CREATE INDEX idx_j_bot_classification ON journeys(bot_classification);

COMMENT ON TABLE journeys IS 'Cross-site visitor journeys for funnel analysis';
COMMENT ON COLUMN journeys.funnel_stage IS '1=Stage 1 only, 2=Stages 1-2, 3=All stages (completed funnel)';

-- ============================================================================
-- Ingestion State Table
-- ============================================================================

CREATE TABLE ingestion_state (
  id SERIAL PRIMARY KEY,
  last_processed_timestamp TIMESTAMPTZ NOT NULL,
  last_cf_ray TEXT,
  records_processed INTEGER,
  ingestion_duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_is_created_at ON ingestion_state(created_at DESC);

COMMENT ON TABLE ingestion_state IS 'Tracks ingestion progress to prevent duplicate processing';
COMMENT ON COLUMN ingestion_state.last_processed_timestamp IS 'Latest event timestamp that was processed';

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to get subnet from IP (IPv4 /24)
CREATE OR REPLACE FUNCTION get_subnet_24(ip INET)
RETURNS CIDR AS $$
BEGIN
  RETURN set_masklen(ip, 24);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION get_subnet_24 IS 'Extract /24 subnet from IP address for clustering';

-- Function to calculate funnel stage
CREATE OR REPLACE FUNCTION calculate_funnel_stage(sites TEXT[])
RETURNS INTEGER AS $$
BEGIN
  IF 'thaibelle.com' = ANY(sites) THEN
    RETURN 3;
  ELSIF 'memorycareguide.org' = ANY(sites) THEN
    RETURN 2;
  ELSIF 'veteransmemorycare.org' = ANY(sites) THEN
    RETURN 1;
  ELSE
    RETURN 0; -- Unknown site
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_funnel_stage IS 'Determine highest funnel stage reached (1-3)';

-- ============================================================================
-- Views for Common Queries
-- ============================================================================

-- View: Bot traffic summary by classification
CREATE VIEW v_bot_summary AS
SELECT
  bot_classification,
  COUNT(*) as total_requests,
  COUNT(DISTINCT client_ip) as unique_ips,
  MIN(timestamp) as first_seen,
  MAX(timestamp) as last_seen,
  ROUND(AVG(duration)::numeric, 4) as avg_duration_sec,
  ROUND((SUM(response_size) / 1024.0 / 1024.0)::numeric, 2) as total_mb
FROM events
WHERE is_bot = true
GROUP BY bot_classification;

COMMENT ON VIEW v_bot_summary IS 'Summary of bot traffic by classification type';

-- View: Daily traffic stats
CREATE VIEW v_daily_stats AS
SELECT
  DATE(timestamp) as date,
  site,
  bot_classification,
  COUNT(*) as requests,
  COUNT(DISTINCT client_ip) as unique_ips
FROM events
GROUP BY DATE(timestamp), site, bot_classification
ORDER BY date DESC, requests DESC;

COMMENT ON VIEW v_daily_stats IS 'Daily traffic statistics by site and bot classification';

-- ============================================================================
-- Grant Permissions (uncomment and customize for your user)
-- ============================================================================

-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO analytics_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO analytics_user;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO analytics_user;

-- ============================================================================
-- Initial Data / Test Records
-- ============================================================================

-- Insert initial ingestion state (starting point)
INSERT INTO ingestion_state (last_processed_timestamp, last_cf_ray, records_processed, ingestion_duration_ms)
VALUES ('2025-01-01 00:00:00+00', NULL, 0, 0);

COMMENT ON TABLE ingestion_state IS 'Initial state: 2025-01-01 00:00:00 UTC';

-- ============================================================================
-- Database Statistics
-- ============================================================================

-- Show table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Show index sizes
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(schemaname||'.'||indexname)) AS size
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(schemaname||'.'||indexname) DESC;

-- ============================================================================
-- Schema Version
-- ============================================================================

COMMENT ON SCHEMA public IS 'Vivocare 3DS Analytics Schema v1.0 - Created 2025-11-06';
