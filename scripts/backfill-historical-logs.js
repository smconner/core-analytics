#!/usr/bin/env node
/**
 * Historical Log Backfill Script
 * Processes historical Caddy logs from a specified date range
 * Filters to include only: veteransmemorycare.org, memorycareguide.org, thaibelle.com, modelzero.com
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

// Import our modules
import { initGeoIP, lookupCity } from '../lib/geoip.js';
import { initASN, lookupASN } from '../lib/asn-lookup.js';
import { classify, detectBrowserSignals, extractBotHeaders, detectSecurityFlags } from '../lib/ai-classifier.js';

const { Pool } = pg;
const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG_PATH = path.join(__dirname, '../config/config.json');
const BATCH_SIZE = 100;

// Sites to include in backfill (3-stage funnel + dashboard)
const INCLUDED_SITES = [
  'veteransmemorycare.org',
  'www.veteransmemorycare.org',
  'memorycareguide.org',
  'www.memorycareguide.org',
  'thaibelle.com',
  'www.thaibelle.com',
  'modelzero.com',
  'www.modelzero.com'
];

/**
 * Load configuration
 */
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Configuration file not found: ${CONFIG_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

/**
 * Extract Caddy logs for a specific date range
 */
async function extractLogsForDateRange(startDate, endDate) {
  const startStr = startDate.toISOString();
  const endStr = endDate.toISOString();

  console.log(`  Extracting logs from ${startStr} to ${endStr}...`);

  const command = `journalctl -u caddy --since "${startStr}" --until "${endStr}" --output=cat`;

  try {
    const { stdout } = await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });

    const lines = stdout.trim().split('\n').filter(line => line.length > 0);
    console.log(`  Found ${lines.length} log entries`);

    const events = [];
    let filtered = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Only process access logs (handle both logger names)
        if (!entry.logger || (!entry.logger.startsWith('http.log.access')) || !entry.request) {
          continue;
        }

        const site = entry.request.host;

        // Filter to only included sites
        if (!INCLUDED_SITES.includes(site)) {
          filtered++;
          continue;
        }

        // Extract event data
        const event = {
          timestamp: new Date(entry.ts * 1000),
          duration: entry.duration || 0,
          client_ip: entry.request.headers['Cf-Connecting-Ip']?.[0] || entry.request.remote_ip,
          site: site,
          method: entry.request.method,
          path: entry.request.uri,
          status: entry.status,
          response_size: entry.size || 0,
          user_agent: entry.request.headers['User-Agent']?.[0] || '',
          referer: entry.request.headers['Referer']?.[0] || null,
          country: entry.request.headers['Cf-Ipcountry']?.[0] || null,
          cf_ray: entry.request.headers['Cf-Ray']?.[0] || null,
          headers_json: entry.request.headers
        };

        events.push(event);
      } catch (e) {
        // Skip invalid JSON lines
        continue;
      }
    }

    console.log(`  Filtered ${filtered} entries (excluded sites)`);
    console.log(`  Processing ${events.length} relevant events`);

    return events;
  } catch (error) {
    console.error(`  Error extracting logs: ${error.message}`);
    return [];
  }
}

/**
 * Enrich events with GeoIP, ASN, and bot classification
 */
async function enrichEvents(events) {
  console.log(`  Enriching ${events.length} events...`);

  const enriched = [];

  for (const event of events) {
    // GeoIP lookup
    const geoData = lookupCity(event.client_ip);
    event.country = event.country || geoData.country;
    event.city = geoData.city;
    event.latitude = geoData.latitude;
    event.longitude = geoData.longitude;

    // Calculate subnet
    if (event.client_ip.includes(':')) {
      // IPv6 - use /64
      const parts = event.client_ip.split(':').filter(p => p !== '');
      if (parts.length >= 4) {
        event.subnet = parts.slice(0, 4).join(':') + '::/64';
      } else {
        event.subnet = parts.join(':') + '::/64';
      }
    } else {
      // IPv4 - use /24
      const parts = event.client_ip.split('.');
      event.subnet = parts.slice(0, 3).join('.') + '.0/24';
    }

    // ASN lookup
    const asnData = lookupASN(event.client_ip);
    event.asn = asnData.asn;
    event.asn_org = asnData.organization;
    event.datacenter_provider = asnData.datacenter_provider;

    // Bot classification
    const classification = await classify(event.client_ip, event.user_agent, event.headers_json);
    event.is_bot = classification.is_bot;
    event.bot_classification = classification.bot_classification;
    event.bot_name = classification.bot_name;
    event.detection_level = classification.detection_level;
    event.bot_type = classification.bot_type;

    // Browser signals
    const browserSignals = detectBrowserSignals(event.user_agent, event.headers_json);
    event.has_js_capability = browserSignals.hasJavaScript;
    event.has_cookie_capability = browserSignals.hasCookies;
    event.browser_name = browserSignals.browserName;
    event.browser_version = browserSignals.browserVersion;
    event.os_name = browserSignals.osName;
    event.device_type = browserSignals.deviceType;

    // Bot headers
    const botHeaders = extractBotHeaders(event.headers_json);
    event.bot_intent = botHeaders.intent;
    event.bot_email = botHeaders.email;
    event.crawl_delay_respected = botHeaders.crawlDelay;

    // Security flags
    const securityFlags = detectSecurityFlags(event.headers_json, event.path);
    event.is_vpn_proxy = securityFlags.isVpnProxy;
    event.is_tor = securityFlags.isTor;
    event.has_security_headers = securityFlags.hasSecurityHeaders;

    enriched.push(event);
  }

  console.log(`  Enrichment complete`);
  return enriched;
}

/**
 * Batch insert events
 */
async function batchInsertEvents(pool, events) {
  if (!events || events.length === 0) {
    return 0;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const fields = [
      'timestamp', 'duration', 'client_ip', 'country', 'city', 'latitude', 'longitude',
      'cf_ray', 'subnet', 'asn', 'asn_org', 'datacenter_provider', 'site', 'method',
      'path', 'status', 'response_size', 'user_agent',
      'is_bot', 'bot_classification', 'bot_name', 'detection_level', 'referer',
      'headers_json'
    ];

    const valueStrings = events.map((_, i) => {
      const offset = i * fields.length;
      const placeholders = fields.map((_, j) => `$${offset + j + 1}`).join(', ');
      return `(${placeholders})`;
    }).join(',\n  ');

    const flatValues = events.flatMap(e => [
      e.timestamp,
      e.duration || 0,
      e.client_ip,
      e.country,
      e.city,
      e.latitude,
      e.longitude,
      e.cf_ray,
      e.subnet,
      e.asn,
      e.asn_org,
      e.datacenter_provider,
      e.site,
      e.method,
      e.path,
      e.status,
      e.response_size || 0,
      e.user_agent,
      e.is_bot,
      e.bot_classification,
      e.bot_name,
      e.detection_level,
      e.referer,
      JSON.stringify(e.headers_json)
    ]);

    const query = `
      INSERT INTO events (${fields.join(', ')})
      VALUES ${valueStrings}
    `;

    const result = await client.query(query, flatValues);
    await client.query('COMMIT');

    return result.rowCount;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check if events already exist for this date range
 */
async function checkExistingData(pool, startDate, endDate) {
  const result = await pool.query(
    `SELECT COUNT(*) as count
     FROM events
     WHERE timestamp >= $1 AND timestamp < $2`,
    [startDate, endDate]
  );

  return parseInt(result.rows[0].count);
}

/**
 * Process a single day of logs
 */
async function processDay(pool, dateStr) {
  // Parse date in UTC to avoid timezone issues
  const startDate = new Date(dateStr + 'T00:00:00.000Z');
  const endDate = new Date(dateStr + 'T23:59:59.999Z');

  console.log(`\nProcessing ${dateStr}...`);

  // Check if data already exists
  const existingCount = await checkExistingData(pool, startDate, endDate);
  if (existingCount > 0) {
    console.log(`  ⚠️  Found ${existingCount} existing events - skipping to avoid duplicates`);
    return { processed: 0, skipped: existingCount };
  }

  // Extract logs for this day
  const events = await extractLogsForDateRange(startDate, endDate);

  if (events.length === 0) {
    console.log(`  No events found for this day`);
    return { processed: 0, skipped: 0 };
  }

  // Enrich events
  const enrichedEvents = await enrichEvents(events);

  // Insert in batches
  console.log(`  Inserting ${enrichedEvents.length} events...`);
  let inserted = 0;

  for (let i = 0; i < enrichedEvents.length; i += BATCH_SIZE) {
    const batch = enrichedEvents.slice(i, i + BATCH_SIZE);
    const count = await batchInsertEvents(pool, batch);
    inserted += count;

    if (inserted % 500 === 0 || inserted === enrichedEvents.length) {
      console.log(`    Inserted ${inserted}/${enrichedEvents.length}...`);
    }
  }

  console.log(`  ✅ Inserted ${inserted} events`);
  return { processed: inserted, skipped: 0 };
}

/**
 * Main backfill function
 */
async function backfill(startDateStr, endDateStr) {
  console.log('=================================================================');
  console.log('ModelZero Analytics - Historical Log Backfill');
  console.log('=================================================================');
  console.log('');
  console.log('Included sites:');
  INCLUDED_SITES.forEach(site => console.log(`  - ${site}`));
  console.log('');
  console.log(`Date range: ${startDateStr} to ${endDateStr}`);
  console.log('');

  // Parse dates
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  if (isNaN(startDate) || isNaN(endDate)) {
    console.error('Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  // Initialize
  console.log('Initializing...');
  const config = loadConfig();

  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
    max: 20
  });

  await initGeoIP(config);
  await initASN(config);
  console.log('');

  // Process each day
  const stats = { totalProcessed: 0, totalSkipped: 0, days: 0 };

  let currentDate = new Date(startDateStr);
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const result = await processDay(pool, dateStr);
    stats.totalProcessed += result.processed;
    stats.totalSkipped += result.skipped;
    stats.days++;

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Close connection
  await pool.end();

  // Summary
  console.log('');
  console.log('=================================================================');
  console.log('Backfill Complete!');
  console.log('=================================================================');
  console.log(`Days processed: ${stats.days}`);
  console.log(`Events inserted: ${stats.totalProcessed}`);
  console.log(`Events skipped (already existed): ${stats.totalSkipped}`);
  console.log('');
  console.log('Dashboard should now show data for 7D and 30D views');
  console.log('');
}

// Command-line interface
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Usage:');
  console.log('  node scripts/backfill-historical-logs.js <start-date> <end-date>');
  console.log('');
  console.log('Example:');
  console.log('  node scripts/backfill-historical-logs.js 2025-10-01 2025-11-04');
  console.log('');
  console.log('Or via npm:');
  console.log('  npm run backfill 2025-10-01 2025-11-04');
  process.exit(1);
}

const [startDate, endDate] = args;

backfill(startDate, endDate).catch(error => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
