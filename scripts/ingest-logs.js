#!/usr/bin/env node
/**
 * Log Ingestion Pipeline
 * Extracts Caddy logs and inserts into PostgreSQL
 * Run every 10 minutes via cron
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Import our modules
import { initDB, batchInsert, getLastProcessedTimestamp, updateIngestionState, testConnection, closeDB } from '../lib/db.js';
import { initGeoIP, lookupCity } from '../lib/geoip.js';
import { initASN, lookupASN } from '../lib/asn-lookup.js';
import { classify, detectBrowserSignals, extractBotHeaders, detectSecurityFlags } from '../lib/ai-classifier-v2.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG_PATH = path.join(__dirname, '../config/config.json');
const BATCH_SIZE = 100;

// CrowdSec banned IP cache - refreshed periodically
let bannedIPsCache = new Set();
let bannedIPsCacheTime = 0;
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Load configuration
 */
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Configuration file not found: ${CONFIG_PATH}`);
    console.error('Please create config/config.json (see config/config.example.json)');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return config;
}

/**
 * Refresh CrowdSec banned IPs cache
 * Query CrowdSec LAPI for all currently banned IPs
 */
async function refreshBannedIPsCache() {
  const now = Date.now();

  // Return cached data if still fresh
  if (now - bannedIPsCacheTime < CACHE_TTL) {
    return;
  }

  try {
    // Query CrowdSec for all active decisions (banned IPs)
    const { stdout } = await execAsync('sudo cscli decisions list -o json');

    if (!stdout.trim()) {
      bannedIPsCache = new Set();
      bannedIPsCacheTime = now;
      return;
    }

    // Parse JSON output
    const decisions = JSON.parse(stdout);

    // Extract IPs from decisions array
    const bannedIPs = new Set();
    if (Array.isArray(decisions)) {
      for (const decision of decisions) {
        if (decision.value) {
          // decision.value contains the IP address
          bannedIPs.add(decision.value);
        }
      }
    }

    bannedIPsCache = bannedIPs;
    bannedIPsCacheTime = now;

    console.log(`  CrowdSec cache refreshed: ${bannedIPs.size} banned IPs`);
  } catch (err) {
    console.warn('  Failed to refresh CrowdSec cache:', err.message);
    // Keep existing cache on error
  }
}

/**
 * Check if an IP is banned by CrowdSec
 * @param {string} ip - IP address to check
 * @returns {boolean} True if IP is banned
 */
function isBannedIP(ip) {
  return bannedIPsCache.has(ip);
}

/**
 * Extract Caddy logs since last processed timestamp
 * @param {Date|null} since - Timestamp to start from
 * @returns {Promise<Array>} Array of log entries
 */
async function extractLogs(since) {
  let command;

  if (since) {
    const sinceStr = since.toISOString();
    command = `journalctl -u caddy --since "${sinceStr}" --output=cat | grep 'http.log.access'`;
  } else {
    // First run - get last 1 hour
    command = `journalctl -u caddy --since "1 hour ago" --output=cat | grep 'http.log.access'`;
  }

  try {
    const { stdout } = await execAsync(command, { maxBuffer: 50 * 1024 * 1024 }); // 50MB buffer
    if (!stdout.trim()) {
      return [];
    }

    // Parse JSON log entries
    const lines = stdout.trim().split('\n');
    const entries = [];

    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        entries.push(json);
      } catch (err) {
        console.warn('Failed to parse log line:', line.substring(0, 100));
      }
    }

    return entries;
  } catch (err) {
    if (err.code === 1) {
      // journalctl returns exit code 1 when no matching entries
      return [];
    }
    throw err;
  }
}

/**
 * Parse Caddy log entry into event object
 * @param {Object} logEntry - Raw Caddy log entry
 * @returns {Object} Parsed event
 */
function parseLogEntry(logEntry) {
  const request = logEntry.request || {};
  const headers = request.headers || {};

  // Extract real client IP from Cloudflare header
  const clientIP = (headers['Cf-Connecting-Ip'] || [])[0] ||
                   (headers['X-Forwarded-For'] || [])[0] ||
                   request.client_ip;

  // Filter out home IP addresses and subnets
  const HOME_IPS = ['184.82.29.117'];
  const HOME_SUBNETS = ['2405:9800:b911:2816::/64']; // Your AIS Fibre subnet

  // Check if IP matches excluded IPs
  if (HOME_IPS.includes(clientIP)) {
    return null; // Skip this event
  }

  // Check if IP matches excluded subnets
  for (const subnet of HOME_SUBNETS) {
    if (subnet.includes('::')) {
      // IPv6 subnet check - compare first 4 hextets
      const subnetPrefix = subnet.split('::')[0];
      const ipPrefix = clientIP.split(':').slice(0, 4).join(':');
      if (clientIP.startsWith(subnetPrefix) || ipPrefix === subnetPrefix) {
        return null; // Skip this event
      }
    } else {
      // IPv4 subnet check - compare first 3 octets
      const subnetPrefix = subnet.split('.').slice(0, 3).join('.');
      const ipPrefix = clientIP.split('.').slice(0, 3).join('.');
      if (ipPrefix === subnetPrefix) {
        return null; // Skip this event
      }
    }
  }

  // Check if IP is banned by CrowdSec
  if (isBannedIP(clientIP)) {
    return null; // Skip CrowdSec-banned IPs
  }

  // Parse URI into path and query string
  const uri = request.uri || '/';
  const [path, queryString] = uri.split('?');

  // Filter out excluded sites
  const EXCLUDED_SITES = [
    'pm.vivocare.org',
    'dementiarelocationsolutions.com',
    'www.dementiarelocationsolutions.com'
  ];
  const site = request.host || 'unknown';
  if (EXCLUDED_SITES.includes(site)) {
    return null; // Skip this event
  }

  // Filter out WordPress scanner traffic
  const WORDPRESS_PATTERNS = [
    /^\/wp-admin/i,
    /^\/wordpress\/wp-admin/i,
    /^\/wp\//i,
    /wp-login\.php/i,
    /xmlrpc\.php/i,
    /wp-config/i,
    /setup-config\.php/i,
    /\/wp-content\/(plugins|themes)/i,
    /\/wp-includes\//i,
    /wp-json\/wp\/v2\/users/i,
    /readme\.html$/i,
    /license\.txt$/i,
    /wp-cron\.php/i,
    /\?author=/i,
    /wp-sitemap/i,
    /debug\.log/i,
    /\/\.env/i,
    /phpmyadmin/i,
    /\/pma\//i,
    /\/dbadmin/i,
    /sqladmin/i,
    /mysqladmin/i,
    /\/\.git/i,
    /\/\.svn/i,
    /\.(bak|backup|old|save|orig|swp)$/i,
    /~$/
  ];

  const isWordPressScanner = WORDPRESS_PATTERNS.some(pattern => pattern.test(path + (queryString ? '?' + queryString : '')));
  if (isWordPressScanner) {
    return null; // Skip WordPress scanner traffic
  }

  return {
    // Timing
    timestamp: new Date(logEntry.ts * 1000),
    duration: logEntry.duration || 0,

    // Client
    client_ip: clientIP,
    cf_ray: (headers['Cf-Ray'] || [])[0] || null,

    // Request
    site: site,
    method: request.method || 'GET',
    path: path || '/',
    query_string: queryString || null,

    // Response
    status: logEntry.status || 0,
    response_size: logEntry.size || 0,
    content_type: null, // Will be extracted from response headers if needed

    // Headers
    user_agent: (headers['User-Agent'] || [])[0] || null,
    referer: (headers['Referer'] || [])[0] || null,
    accept_language: (headers['Accept-Language'] || [])[0] || null,

    // Raw headers for analysis
    headers: headers
  };
}

/**
 * Enrich event with GeoIP, ASN, and classification
 * @param {Object} event - Parsed event
 * @returns {Promise<Object>} Enriched event
 */
async function enrichEvent(event) {
  // GeoIP lookup
  const geoData = lookupCity(event.client_ip);
  event.country = geoData.country;
  event.city = geoData.city;
  event.latitude = geoData.latitude;
  event.longitude = geoData.longitude;

  // ASN lookup
  const asnData = lookupASN(event.client_ip);
  event.asn = asnData.asn;
  event.asn_org = asnData.asn_org;
  event.datacenter_provider = asnData.datacenter_provider;

  // Calculate subnet (/24 for IPv4, /64 for IPv6)
  if (event.client_ip.includes(':')) {
    // IPv6 - use /64 (first 4 hextets)
    const parts = event.client_ip.split(':').filter(p => p !== '');
    if (parts.length >= 4) {
      event.subnet = parts.slice(0, 4).join(':') + '::/64';
    } else {
      // Handle compressed notation
      event.subnet = parts.join(':') + '::/64';
    }
  } else {
    // IPv4 - use /24
    const parts = event.client_ip.split('.');
    event.subnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }

  // Bot classification
  const classification = await classify({
    client_ip: event.client_ip,
    user_agent: event.user_agent,
    headers: event.headers,
    asn: event.asn,
    datacenter_provider: event.datacenter_provider
  });

  event.is_bot = classification.is_bot;
  event.bot_classification = classification.bot_classification;
  event.bot_name = classification.bot_name;
  event.detection_level = classification.detection_level;

  // Browser signals
  const browserSignals = detectBrowserSignals(event.headers);
  event.has_sec_fetch_headers = browserSignals.has_sec_fetch_headers;
  event.has_client_hints = browserSignals.has_client_hints;
  event.is_mobile = browserSignals.is_mobile;

  // Bot-specific headers
  const botHeaders = extractBotHeaders(event.headers);
  event.bot_from_email = botHeaders.bot_from_email;
  event.openai_host_hash = botHeaders.openai_host_hash;

  // Security flags
  const securityFlags = detectSecurityFlags(event.headers, event.path);
  event.has_cf_worker = securityFlags.has_cf_worker;
  event.cf_worker_domain = securityFlags.cf_worker_domain;
  event.is_exploit_attempt = securityFlags.is_exploit_attempt;

  // Store full headers as JSON
  event.headers_json = event.headers;

  // Remove headers from top level (stored in headers_json)
  delete event.headers;

  return event;
}

/**
 * Main ingestion function
 */
async function ingest() {
  const startTime = Date.now();
  console.log('='.repeat(60));
  console.log('Starting log ingestion:', new Date().toISOString());
  console.log('='.repeat(60));

  try {
    // Load configuration
    const config = loadConfig();

    // Initialize modules
    initDB(config.database);
    await initGeoIP(config.geoip?.city_db);
    await initASN(config.geoip?.asn_db);

    // Test database connection
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Database connection failed');
    }

    // Refresh CrowdSec banned IPs cache
    console.log('Refreshing CrowdSec banned IPs cache...');
    await refreshBannedIPsCache();

    // Get last processed timestamp
    const lastProcessed = await getLastProcessedTimestamp();
    console.log('Last processed timestamp:', lastProcessed || 'Never');

    // Extract logs
    console.log('Extracting logs from journalctl...');
    const logEntries = await extractLogs(lastProcessed);
    console.log(`Found ${logEntries.length} new log entries`);

    if (logEntries.length === 0) {
      console.log('No new logs to process');
      await closeDB();
      return;
    }

    // Parse and enrich events
    console.log('Parsing and enriching events...');
    const events = [];
    let latestTimestamp = lastProcessed;
    let latestCfRay = null;
    let filteredCount = 0;

    for (const logEntry of logEntries) {
      try {
        const event = parseLogEntry(logEntry);
        if (event === null) {
          filteredCount++;
          continue; // Skip filtered IPs
        }

        const enrichedEvent = await enrichEvent(event);
        events.push(enrichedEvent);

        // Track latest timestamp
        if (!latestTimestamp || enrichedEvent.timestamp > latestTimestamp) {
          latestTimestamp = enrichedEvent.timestamp;
          latestCfRay = enrichedEvent.cf_ray;
        }
      } catch (err) {
        console.error('Failed to process log entry:', err.message);
      }
    }

    console.log(`Processed ${events.length} events (${filteredCount} filtered)`);

    // Batch insert into database
    if (events.length > 0) {
      console.log(`Inserting ${events.length} events into database...`);

      // Split into batches
      for (let i = 0; i < events.length; i += BATCH_SIZE) {
        const batch = events.slice(i, i + BATCH_SIZE);
        const inserted = await batchInsert(batch);
        console.log(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${inserted} records`);
      }

      // Update ingestion state
      const duration = Date.now() - startTime;
      await updateIngestionState(latestTimestamp, latestCfRay, events.length, duration);

      console.log('Ingestion complete');
      console.log(`  Records processed: ${events.length}`);
      console.log(`  Duration: ${duration}ms`);
      console.log(`  Latest timestamp: ${latestTimestamp.toISOString()}`);
    }

    // Close database
    await closeDB();

    console.log('='.repeat(60));
    console.log('Ingestion finished successfully');
    console.log('='.repeat(60));

  } catch (err) {
    console.error('Ingestion failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run ingestion
ingest();
