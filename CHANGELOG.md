# ModelZero Analytics Changelog

## v1.1 - Classification System V2 (2025-11-12)

### Major Changes

#### 🎯 New Systematic Bot Classification
Complete rewrite of classification logic using 4-stage waterfall approach:
1. **Rule out human** - Strict verification (Sec-Fetch headers + not datacenter)
2. **Identify attack traffic** - Separate malicious scanners
3. **Categorize AI type** - Official AI, crawlers, stealth AI
4. **Fallback** - Undetermined bot

#### 🔒 Strict Human Verification
- **BREAKING**: Humans now require Sec-Fetch headers (real browser fingerprint)
- **BREAKING**: Datacenter IPs are NEVER classified as human
- Headless browsers (Puppeteer, Selenium) automatically flagged as bots
- Request rate limits (<0.5 req/sec for humans)

#### 🚨 Attack Traffic Detection
New categories for security analysis:
- `attack_wordpress_scanner` - WordPress vulnerability scanning
- `attack_webshell_scanner` - Web shell/backdoor attempts
- `attack_config_scanner` - Config file/database scanners
- `attack_exploit_attempt` - Active exploit attempts (XSS, SQLi, etc.)

#### 📊 New Bot Categories
- `human` - Real humans (strict verification)
- `ai_official` - Declared AI bots (GPTBot, ClaudeBot, etc.)
- `ai_stealth` - Undeclared AI (datacenter + spoofed UA + no Sec-Fetch)
- `web_crawler` - Traditional crawlers (Googlebot, Bingbot, etc.)
- `bot_undetermined` - Unknown bot type (not human, can't categorize)
- `attack_*` - Attack traffic (4 subcategories)

#### 🎨 Updated Color Scheme
- **Human**: Green (#10b981)
- **Official AI**: Blue (#3b82f6)
- **Stealth AI**: Orange (#f59e0b)
- **Web Crawler**: Cyan (#06b6d4)
- **Undetermined Bot**: Gray (#64748b)
- **Attack Traffic**: Red shades (#ef4444, #dc2626, #b91c1c, #991b1b)

### Technical Changes

#### Database
- Extended `bot_classification` VARCHAR(20) → VARCHAR(30)
- Added indexes: `idx_events_bot_classification`, `idx_events_is_bot`, `idx_events_timestamp_classification`
- Dropped views: `v_bot_summary`, `v_daily_stats`

#### API Endpoints
Updated `/api/stats` response:
```json
{
  "aiOfficial": 51,
  "aiStealth": 39,
  "botUndetermined": 654,
  "attackTraffic": 19,
  "human": 14
}
```

Updated `/api/bot-classification` categories:
- Added: "Attack: WordPress", "Attack: WebShell", "Attack: Config", "Attack: Exploit"
- Added: "Undetermined Bot"
- Renamed: "Official AI" (was "Official AI"), "Stealth AI" (was "Stealth AI")

Updated `/api/geographic-heatmap`:
- Added `attack_count` field

#### Classifier
New file: `lib/ai-classifier-v2.js`
- Replaces: `lib/ai-classifier.js`
- Systematic rule-based classification
- 100% headless browser detection
- Path-based attack detection
- Transparent fallback handling

### Migration Stats

**Before V2:**
- Human: 7,647 (73.2%)
- Stealth AI: 1,058 (10.1%)
- AI Training: 982 (9.4%)
- Web Crawler: 397 (3.8%)
- Official AI: 357 (3.4%)

**After V2:**
- Undetermined Bot: 7,231 (69.2%)
- Web Crawler: 1,907 (18.3%)
- Official AI: 730 (7.0%)
- Stealth AI: 265 (2.5%)
- Human: 240 (2.3%)
- Attack Traffic: 70 (0.7%)

### Documentation
- Added: `CLASSIFICATION_V2.md` - Complete system documentation
- Added: `scripts/reclassify-all-v2.js` - Reclassification tool
- Added: `scripts/migrate-to-v2.sql` - Database migration
- Added: `scripts/investigate-ips.js` - IP legitimacy analysis

### Breaking Changes

⚠️ **Human traffic dropped from 73% to 2%**
- This is correct behavior - previous system was too lenient
- Most "humans" were actually bots without Sec-Fetch headers

⚠️ **API response structure changed**
- `officialAI` → `aiOfficial`
- `stealthAI` → `aiStealth`
- Removed: `aiTraining` (merged into `aiStealth`)
- Added: `botUndetermined`, `attackTraffic`

⚠️ **Bot classification values changed**
- Database values use underscores: `ai_official`, `ai_stealth`, `bot_undetermined`
- Display names use spaces: "Official AI", "Stealth AI", "Undetermined Bot"

### Files Changed
- `lib/ai-classifier-v2.js` (NEW)
- `scripts/ingest-logs.js` (imports V2 classifier)
- `server.js` (updated API queries)
- `public/dashboard.js` (updated colors and categories)
- `public/index.html` (version bump)
- `public/explore.html` (version bump)

---

## v1.02 - ThaiBelle Memory Care Filter (2025-11-11)

### Features
- Added "🔬 Memory Care Only" toggle button
- Filters ThaiBelle traffic to show only dementia/memory care content
- Applied to all API endpoints and visualizations

### Changes
- Added `getThaibelleFilter()` helper in server.js
- Updated all 5 API endpoints to support filter
- Added filter state management in dashboard.js

---

## v1.01 - Initial Release (2025-11-10)

### Features
- Real-time AI bot traffic visualization
- Multi-site overlay timeline
- Geographic heatmap with 3 visualization modes
- Bot classification breakdown
- Top AI bots detection
- 3-level classification: User-Agent, Datacenter IP, Behavioral

### Core Components
- Log ingestion pipeline
- PostgreSQL analytics database
- Express API server
- Chart.js visualizations
- Leaflet geographic maps
