# Core Analytics

AI bot behavior tracking and analytics platform for the ModelZero marketing funnel.

## Service Management

```bash
# Restart (preferred - systemd auto-restarts)
pkill -f "/var/www/modelzero.com/server.js"

# Status & logs
systemctl status modelzero.service
journalctl -u modelzero.service -f
tail -f logs/server.log
```

**CRITICAL:** Never use `pkill -9 node` - kills VS Code server. Use path-specific kills.

## Architecture

```
core-analytics/
├── config/
│   ├── config.json           # DB + GeoIP config (gitignored)
│   └── config.example.json   # Template
├── lib/
│   ├── db.js                 # PostgreSQL connection
│   ├── ai-classifier.js      # Bot detection logic
│   ├── asn-lookup.js         # Datacenter detection
│   └── geoip.js              # GeoIP lookups
├── scripts/                   # Data pipeline scripts
│   └── ingest-logs.js        # Main log ingestion
├── public/                    # Dashboard frontend
│   ├── index.html            # Main dashboard
│   ├── explore.html          # Data explorer
│   └── search-intelligence/  # Search monitoring UI
└── server.js                  # Express API server (port 3000)
```

## Database

PostgreSQL `analytics` database. Key tables:

| Table | Purpose |
|-------|---------|
| events | Raw HTTP requests with bot classification |
| behavior_patterns | Level 3 behavioral detection |
| journeys | Cross-site visitor journeys |
| ingestion_state | Ingestion progress tracking |

## API Endpoints

```
GET /api/stats?range=24h          # Traffic statistics
GET /api/timeline?range=24h       # Time series data
GET /api/bot-classification       # Bot breakdown
GET /api/top-bots?range=24h       # Top bots by volume
GET /api/dashboard?range=24h      # Full dashboard data
GET /api/search/*                 # Proxied to search-intelligence:3002
```

## Bot Detection Levels

| Level | Method | Examples |
|-------|--------|----------|
| 1 | User-Agent | GPTBot, ClaudeBot, Googlebot |
| 2 | Datacenter IP | Azure, AWS, GCP ASN ranges |
| 3 | Behavioral | Rapid sequential, cross-site patterns |

## Log Ingestion

```bash
# Run once
node scripts/ingest-logs.js

# Via cron (every 10 minutes)
*/10 * * * * cd /var/www/modelzero.com/core-analytics && node scripts/ingest-logs.js
```

## Configuration

Copy example and fill in values:
```bash
cp config/config.example.json config/config.json
```

Required fields:
- `database.*` - PostgreSQL connection
- `geoip.city_db` - Path to GeoLite2-City.mmdb
- `geoip.asn_db` - Path to GeoLite2-ASN.mmdb
- `sites` - Domains to track

## Tech Stack

- Node.js 18+
- PostgreSQL 14+
- Express.js
- Chart.js (frontend)
- MaxMind GeoIP
