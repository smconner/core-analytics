CORE ANALYTICS - AI bot behavior tracking for ModelZero marketing funnel

SERVICE
$ pkill -f "/var/www/modelzero.com/core-analytics/server.js"   # restart (systemd auto-restarts)
$ systemctl status modelzero.service
$ journalctl -u modelzero.service -f
$ tail -f logs/server.log
CRITICAL: Never pkill -9 node (kills VS Code server)

STRUCTURE
config/config.json - DB + GeoIP config (gitignored), see config.example.json
lib/db.js - PostgreSQL connection
lib/ai-classifier.js - bot detection logic
lib/asn-lookup.js - datacenter detection
lib/geoip.js - GeoIP lookups
scripts/ingest-logs.js - main log ingestion
public/ - dashboard frontend (index.html, explore.html, search-intelligence/)
server.js - Express API (port 3000)

DATABASE (PostgreSQL analytics)
events - raw HTTP requests with bot classification
behavior_patterns - level 3 behavioral detection
journeys - cross-site visitor journeys
ingestion_state - ingestion progress tracking

API
GET /api/stats?range=24h - traffic statistics
GET /api/timeline?range=24h - time series
GET /api/bot-classification - bot breakdown
GET /api/top-bots?range=24h - top bots by volume
GET /api/dashboard?range=24h - full dashboard data
GET /api/search/* - proxied to search-intelligence:3002

BOT DETECTION LEVELS
L1: User-Agent (GPTBot, ClaudeBot, Googlebot)
L2: Datacenter IP (Azure, AWS, GCP ASN ranges)
L3: Behavioral (rapid sequential, cross-site patterns)

INGESTION
$ node scripts/ingest-logs.js                    # run once
Cron: */10 * * * * cd /var/www/modelzero.com/core-analytics && node scripts/ingest-logs.js

CONFIG SETUP
$ cp config/config.example.json config/config.json
Required: database.*, geoip.city_db, geoip.asn_db, sites

STACK: Node.js 18+, PostgreSQL 14+, Express.js, Chart.js, MaxMind GeoIP
