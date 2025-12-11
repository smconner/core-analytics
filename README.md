# Core Analytics System

AI bot behavior tracking and analytics platform for the ModelZero multi-site funnel.

## Purpose

Track and analyze AI bot behavior across a 3-stage marketing funnel:
- **Stage 1**: veteransmemorycare.org
- **Stage 2**: memorycareguide.org
- **Stage 3**: thaibelle.com

## Features

- **3-Level Bot Detection**
  - User-Agent analysis
  - Datacenter IP detection (ASN lookups)
  - Behavioral pattern analysis

- **Enrichment Pipeline**
  - GeoIP location data
  - ASN and datacenter detection
  - Bot classification (AI bots vs crawlers vs humans)

- **Real-time Dashboard**
  - Interactive Chart.js visualizations
  - Funnel progression tracking
  - Bot behavior analysis

## Technology Stack

- **Runtime**: Node.js 18+
- **Database**: PostgreSQL
- **Frontend**: HTML, JavaScript, Chart.js
- **Dependencies**: express, pg, @maxmind/geoip2-node, winston

## Directory Structure

```
core-analytics/
├── lib/                     # Core modules
│   ├── ai-classifier.js    # Bot detection logic
│   ├── asn-lookup.js       # Datacenter detection
│   ├── db.js               # PostgreSQL connection
│   └── geoip.js            # GeoIP lookups
├── scripts/                 # Data pipeline scripts
│   ├── ingest-logs.js      # Main log ingestion
│   └── backfill-historical-logs.js  # Historical data import
├── public/                  # Dashboard frontend
│   ├── index.html          # Analytics dashboard
│   ├── dashboard.js        # Dashboard logic
│   └── explore.html        # Data exploration UI
├── config/                  # Configuration (symlink to shared/config)
├── server.js               # API server
├── schema.sql              # Database schema
└── package.json            # Node.js dependencies
```

## Setup

1. **Install dependencies:**
   ```bash
   cd core-analytics
   npm install
   ```

2. **Configure database:**
   - Edit `config/config.json` (actually in `../shared/config/`)
   - Run schema: `psql -d analytics -f schema.sql`

3. **Start API server:**
   ```bash
   node server.js
   ```
   Dashboard available at: http://localhost:3000

4. **Run log ingestion:**
   ```bash
   node scripts/ingest-logs.js
   ```
   Or via cron: `*/10 * * * * cd /var/www/modelzero.com/core-analytics && node scripts/ingest-logs.js`

## Database Schema

### Main Tables

- **events**: Raw analytics events from Caddy logs
- **behavior_patterns**: Bot behavior detection results
- **journeys**: Cross-site user journeys
- **ingestion_state**: Ingestion progress tracking

## API Endpoints

- `GET /api/events` - Query analytics events
- `GET /api/bot-stats` - Bot statistics
- `GET /api/funnel-progression` - Funnel stage progression

## Related Systems

- **Search Intelligence**: `../search-intelligence/` - Google search tracking
- **Shared Infrastructure**: `../shared/` - VPN, config, logs

## Documentation

See `../docs/` for full documentation:
- `EXECUTION_PLAN.md` - Implementation roadmap
- `SETUP.md` - Setup instructions
- `BACKFILL_PLAN.md` - Historical data backfill guide
