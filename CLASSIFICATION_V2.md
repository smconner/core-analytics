# Bot Classification System V2

## Philosophy

**If it's not definitively human, it's not human.**

The new system uses a systematic 4-stage classification approach that is logical, rule-based, and prioritizes accuracy over leniency.

---

## Classification Stages

### Stage 1: Rule Out Human

A request is classified as **HUMAN** ONLY if it passes ALL of these checks:

1. **Has Sec-Fetch-Site header** - Modern browsers (Chrome 76+, Firefox 90+, Safari 14+) ALWAYS send these headers. No Sec-Fetch = not a real browser = not human.

2. **Has Client Hints OR proper Accept headers** - Real browsers send Client-Hints (Chromium) or proper HTML Accept headers.

3. **NOT from a datacenter** - Azure, AWS, GCP don't host human users. Datacenter IPs are automation infrastructure.

4. **NOT using headless browser** - HeadlessChrome, Puppeteer, Playwright, Selenium are 100% automation tools, never human.

5. **Reasonable request rate** - Humans don't sustain >0.5 requests/second.

**Result:** If ALL checks pass → `human`, otherwise continue to bot classification.

---

### Stage 2: Identify Attack Traffic

Malicious traffic is identified by path patterns:

#### 2A. WordPress/CMS Scanners → `attack_wordpress_scanner`
- Paths: `/wp-admin`, `/wp-login.php`, `/xmlrpc.php`, etc.
- Bot Name: `WordPress-Scanner`

#### 2B. Web Shell Scanners → `attack_webshell_scanner`
- Paths: `/alfa.php`, `/c99.php`, `/shell.php`, `/ALFA_DATA`, etc.
- Bot Name: `WebShell-Scanner`

#### 2C. Config File Scanners → `attack_config_scanner`
- Paths: `/.env`, `/.git`, `/phpmyadmin`, `/config.php`, etc.
- Bot Name: `Config-Scanner`

#### 2D. Exploit Attempts → `attack_exploit_attempt`
- Patterns: directory traversal (`../`), XSS (`<script>`), SQL injection (`union select`)
- Bot Name: `Exploit-Scanner`

**Result:** If attack pattern detected → appropriate attack classification, otherwise continue.

---

### Stage 3: Categorize AI Type

#### 3A. Official AI Bots → `ai_official`

Bots that **declare themselves** in User-Agent:

- **OpenAI:** GPTBot, OAI-SearchBot, ChatGPT-User
- **Anthropic:** ClaudeBot, Claude-Web
- **Google:** Google-Extended, Gemini-Deep-Research, GoogleAgent-Mariner
- **Perplexity:** PerplexityBot
- **Meta:** Meta-ExternalAgent, Meta-ExternalFetcher
- **Others:** Amazonbot, Applebot-Extended, Bytespider, YouBot

**Detection:** User-Agent string match
**Bot Name:** Extracted from User-Agent (e.g., "GPTBot")

#### 3B. Web Crawlers → `web_crawler`

Traditional SEO and social media bots:

- **Search Engines:** Googlebot, Bingbot, Yahoo-Slurp, DuckDuckBot, Baiduspider, YandexBot
- **Social Media:** facebookexternalhit, Twitterbot, LinkedInBot, Slackbot, WhatsApp
- **Generic:** Any User-Agent with "bot", "crawler", "spider", "scraper"

**Detection:** User-Agent string match
**Bot Name:** Extracted (e.g., "Googlebot", "Generic-Crawler")

#### 3C. Stealth AI → `ai_stealth`

Undeclared AI crawlers trying to **hide their identity**:

**Detection Pattern:**
1. From datacenter (Azure, AWS, GCP)
2. Browser-like User-Agent (spoofing Chrome/Safari/Firefox)
3. Missing Sec-Fetch headers (proves it's not a real browser)

**Bot Name:** `{PROVIDER}-Stealth-AI` (e.g., "AZURE-Stealth-AI", "GCP-Stealth-AI")

**Common Examples:**
- Azure VMs with fake Chrome User-Agent
- AWS instances scraping with spoofed browser headers
- GCP Compute instances masquerading as Safari

---

### Stage 4: Undetermined Bot (Fallback)

If we reach this stage, we know it's **NOT HUMAN** but can't categorize it specifically.

**Classification:** `bot_undetermined`
**Bot Name:** `Undetermined-Bot`

**Common Reasons:**
- No User-Agent provided
- Empty/null User-Agent
- Residential IP but missing Sec-Fetch headers
- Browser-like UA but failed human checks
- Unknown automation tool

**Detection Reason Examples:**
- "No User-Agent, Datacenter: azure, Missing Sec-Fetch headers"
- "Missing Sec-Fetch headers"
- "Failed human verification checks"

---

## New Classification Categories

### Current Categories (Old System)
- `human` - Real humans
- `official_ai` - Declared AI bots
- `stealth_ai` - Undeclared datacenter bots
- `ai_training` - Training agent pattern (deprecated in V2)
- `web_crawler` - Traditional crawlers

### New Categories (V2)
- `human` - Real humans (strict verification)
- `ai_official` - Official AI bots (GPTBot, ClaudeBot, etc.)
- `ai_stealth` - Stealth AI crawlers (datacenter + spoofed UA)
- `web_crawler` - Traditional crawlers (Googlebot, etc.)
- `attack_wordpress_scanner` - WordPress vulnerability scanning
- `attack_webshell_scanner` - Web shell/backdoor scanning
- `attack_config_scanner` - Config file/database scanning
- `attack_exploit_attempt` - Active exploit attempts
- `bot_undetermined` - Unknown bot type

---

## Category Mapping for Migration

Old → New mappings:

- `human` → Re-verify, most will become `bot_undetermined` or `ai_stealth`
- `official_ai` → `ai_official` (rename)
- `stealth_ai` → `ai_stealth` (rename)
- `ai_training` → `ai_stealth` (merge, same pattern)
- `web_crawler` → Check for attack patterns first, then `web_crawler`

---

## Dashboard Display

### Category Colors

- **Human** - Green (#10b981)
- **Official AI** - Blue (#3b82f6)
- **Stealth AI** - Orange (#f59e0b)
- **Web Crawler** - Cyan (#06b6d4)
- **Attack Traffic** - Red (#ef4444)
- **Undetermined Bot** - Gray (#64748b)

### Category Display Names

- `human` → "Human"
- `ai_official` → "Official AI"
- `ai_stealth` → "Stealth AI"
- `web_crawler` → "Web Crawler"
- `attack_wordpress_scanner` → "Attack: WordPress"
- `attack_webshell_scanner` → "Attack: WebShell"
- `attack_config_scanner` → "Attack: Config"
- `attack_exploit_attempt` → "Attack: Exploit"
- `bot_undetermined` → "Undetermined Bot"

### Grouping for Stats

- **Human Traffic:** `human`
- **AI Bots:** `ai_official` + `ai_stealth`
- **Web Crawlers:** `web_crawler`
- **Attack Traffic:** All `attack_*` categories
- **Unknown:** `bot_undetermined`

---

## Key Improvements

### 1. Strict Human Verification
- **Before:** Datacenter IPs could be classified as "human"
- **After:** Datacenter IPs are NEVER human

### 2. Headless Browser Detection
- **Before:** Not detected
- **After:** 100% indicator of automation (HeadlessChrome, Puppeteer, etc.)

### 3. Attack Traffic Separation
- **Before:** Mixed with regular traffic or filtered out
- **After:** Categorized by attack type for security analysis

### 4. Systematic Logic
- **Before:** Heuristic-based, sometimes inconsistent
- **After:** Rule-based waterfall, every request goes through same logic

### 5. Transparent Fallback
- **Before:** Might incorrectly classify as "human" by default
- **After:** Explicitly marked as "Undetermined Bot" if can't categorize

---

## Implementation Status

- [x] New classifier created (`ai-classifier-v2.js`)
- [x] Tested with 9 test cases
- [ ] Database schema update for new categories
- [ ] Reclassification script for existing data
- [ ] Update ingestion script to use V2
- [ ] Update dashboard for new categories
- [ ] Deploy to production

---

## Migration Plan

### Phase 1: Database Schema
1. Add new `bot_classification` enum values
2. Create index on `bot_classification` for performance

### Phase 2: Reclassify Existing Data
1. Run reclassification script on all existing events
2. Verify statistics before/after
3. Backup database before migration

### Phase 3: Update Ingestion
1. Switch `ingest-logs.js` to use `ai-classifier-v2.js`
2. Test with recent logs
3. Monitor for any issues

### Phase 4: Update Dashboard
1. Update API queries for new categories
2. Update frontend to display new categories
3. Add attack traffic visualization
4. Update colors and legends

### Phase 5: Verify
1. Run investigation script on known IPs
2. Verify statistics make sense
3. Monitor dashboard for 24 hours

---

## Example Classifications

### Real Human
```
IP: 146.70.76.58
Headers: Sec-Fetch-Site: none, Sec-Ch-Ua: "Chrome"
Provider: None (residential)
→ Classification: human
→ Reason: Passed all human verification checks
```

### Headless Chrome Bot
```
IP: 50.24.28.220
UA: HeadlessChrome/120.0.0.0
Headers: (none)
→ Classification: bot_undetermined
→ Reason: Headless browser detected
```

### GPTBot (Official AI)
```
IP: 74.7.227.134
UA: Mozilla/5.0 (compatible; GPTBot/1.2)
→ Classification: ai_official
→ Bot Name: GPTBot
```

### Azure Stealth AI
```
IP: 172.207.9.124
UA: Mozilla/5.0 Chrome/120.0.0.0
Headers: (no Sec-Fetch)
Provider: azure
→ Classification: ai_stealth
→ Bot Name: AZURE-Stealth-AI
```

### WordPress Scanner
```
IP: 40.113.19.56
Path: /wp-admin/admin.php
→ Classification: attack_wordpress_scanner
→ Bot Name: WordPress-Scanner
```

### Web Shell Scanner
```
IP: 48.210.57.6
Path: /alfa.php
Provider: azure
→ Classification: attack_webshell_scanner
→ Bot Name: WebShell-Scanner
```

### Undetermined Bot
```
IP: 218.104.149.184
UA: Mozilla/5.0 Chrome/120.0.0.0
Headers: (no Sec-Fetch)
Provider: None (residential)
→ Classification: bot_undetermined
→ Reason: Missing Sec-Fetch headers
```
