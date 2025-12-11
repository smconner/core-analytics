#!/usr/bin/env node
/**
 * Detect AI Agents Running in Real Browsers
 *
 * This detects a new emerging threat: AI agents that run inside actual browsers
 * (browser extensions, desktop AI tools, or browser automation) and therefore
 * have legitimate Sec-Fetch headers and Client Hints.
 *
 * Detection strategies:
 * 1. Behavioral patterns (too fast, too systematic)
 * 2. Path patterns (scanning behavior)
 * 3. Temporal patterns (non-human timing)
 * 4. Content focus patterns (AI training indicators)
 */

import { initDB, query, closeDB } from '../lib/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

async function detectAIAgentsInBrowsers() {
  console.log('='.repeat(80));
  console.log('DETECTING AI AGENTS RUNNING IN REAL BROWSERS');
  console.log('='.repeat(80));
  console.log('\nThese are the HARDEST to detect because they:');
  console.log('  - Have legitimate Sec-Fetch headers (real browser)');
  console.log('  - Have Client Hints (real browser)');
  console.log('  - From residential IPs (not datacenter)');
  console.log('  - Currently classified as HUMAN');
  console.log('\nBut they might be:');
  console.log('  - Browser extensions with AI (ChatGPT, Claude, Copilot plugins)');
  console.log('  - Desktop AI assistants browsing (Perplexity, etc.)');
  console.log('  - Automated browsers controlled by AI');
  console.log('  - Research/scraping tools in headful browsers');

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    initDB(config.database);

    // Strategy 1: Too Fast for Humans
    console.log('\n\n' + '='.repeat(80));
    console.log('STRATEGY 1: REQUEST RATE ANALYSIS');
    console.log('='.repeat(80));
    console.log('\nHumans typically make <0.2 requests/second sustained.');
    console.log('AI agents can be much faster, even in browsers.\\n');

    const fastRequests = await query(`
      WITH session_stats AS (
        SELECT
          client_ip,
          user_agent,
          COUNT(*) as request_count,
          COUNT(DISTINCT path) as unique_paths,
          EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) as duration_seconds,
          MIN(timestamp) as first_seen,
          MAX(timestamp) as last_seen,
          has_sec_fetch_headers,
          has_client_hints,
          asn_org,
          country
        FROM events
        WHERE bot_classification = 'human'
          AND datacenter_provider IS NULL
          AND timestamp > NOW() - INTERVAL '30 days'
        GROUP BY client_ip, user_agent, has_sec_fetch_headers,
                 has_client_hints, asn_org, country
        HAVING EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) > 60
      )
      SELECT
        client_ip,
        user_agent,
        request_count,
        unique_paths,
        ROUND((request_count::float / duration_seconds)::numeric, 3) as req_per_sec,
        has_sec_fetch_headers,
        has_client_hints,
        asn_org,
        country,
        first_seen,
        last_seen
      FROM session_stats
      WHERE (request_count::float / duration_seconds) > 0.5
      ORDER BY req_per_sec DESC
      LIMIT 20;
    `);

    if (fastRequests.rows.length > 0) {
      console.log(`Found ${fastRequests.rows.length} "humans" with >0.5 req/sec:\\n`);
      fastRequests.rows.forEach(row => {
        console.log(`${row.client_ip.padEnd(18)} ${String(row.req_per_sec).padStart(6)} req/sec, ${row.request_count} requests, ${row.unique_paths} paths`);
        console.log(`  Country: ${row.country}, ASN: ${(row.asn_org || 'Unknown').substring(0, 50)}`);
        console.log(`  Sec-Fetch: ${row.has_sec_fetch_headers ? 'Yes' : 'No'}, Hints: ${row.has_client_hints ? 'Yes' : 'No'}`);
        console.log(`  Duration: ${new Date(row.first_seen).toISOString()} to ${new Date(row.last_seen).toISOString()}`);
        console.log(`  UA: ${(row.user_agent || 'None').substring(0, 80)}...\\n`);
      });
    } else {
      console.log('✓ No suspicious fast request rates detected.\\n');
    }

    // Strategy 2: Systematic Path Traversal
    console.log('\\n' + '='.repeat(80));
    console.log('STRATEGY 2: SYSTEMATIC PATH TRAVERSAL');
    console.log('='.repeat(80));
    console.log('\nAI agents often visit many distinct paths systematically.');
    console.log('Humans tend to follow links and visit <20 unique pages per session.\\n');

    const systematicBrowsing = await query(`
      SELECT
        client_ip,
        user_agent,
        COUNT(*) as request_count,
        COUNT(DISTINCT path) as unique_paths,
        ROUND((COUNT(DISTINCT path)::float / COUNT(*))::numeric, 2) as path_diversity,
        has_sec_fetch_headers,
        has_client_hints,
        asn_org,
        country
      FROM events
      WHERE bot_classification = 'human'
        AND datacenter_provider IS NULL
        AND timestamp > NOW() - INTERVAL '30 days'
      GROUP BY client_ip, user_agent, has_sec_fetch_headers,
               has_client_hints, asn_org, country
      HAVING COUNT(DISTINCT path) > 50
        OR (COUNT(DISTINCT path)::float / COUNT(*)) > 0.8
      ORDER BY unique_paths DESC
      LIMIT 20;
    `);

    if (systematicBrowsing.rows.length > 0) {
      console.log(`Found ${systematicBrowsing.rows.length} "humans" visiting >50 unique paths:\\n`);
      systematicBrowsing.rows.forEach(row => {
        console.log(`${row.client_ip.padEnd(18)} ${row.request_count} requests, ${row.unique_paths} unique paths (${row.path_diversity} diversity)`);
        console.log(`  Country: ${row.country}, ASN: ${(row.asn_org || 'Unknown').substring(0, 50)}`);
        console.log(`  Sec-Fetch: ${row.has_sec_fetch_headers ? 'Yes' : 'No'}, Hints: ${row.has_client_hints ? 'Yes' : 'No'}`);
        console.log(`  UA: ${(row.user_agent || 'None').substring(0, 80)}...\\n`);
      });
    } else {
      console.log('✓ No suspicious systematic browsing detected.\\n');
    }

    // Strategy 3: Unusual Timing Patterns
    console.log('\\n' + '='.repeat(80));
    console.log('STRATEGY 3: NON-HUMAN TIMING PATTERNS');
    console.log('='.repeat(80));
    console.log('\nAI agents may show perfect intervals or 24/7 activity.\\n');

    const timingPatterns = await query(`
      WITH hourly_activity AS (
        SELECT
          client_ip,
          EXTRACT(HOUR FROM timestamp) as hour,
          COUNT(*) as requests
        FROM events
        WHERE bot_classification = 'human'
          AND datacenter_provider IS NULL
          AND timestamp > NOW() - INTERVAL '7 days'
        GROUP BY client_ip, EXTRACT(HOUR FROM timestamp)
      ),
      active_hours AS (
        SELECT
          client_ip,
          COUNT(DISTINCT hour) as hours_active,
          SUM(requests) as total_requests
        FROM hourly_activity
        WHERE requests > 0
        GROUP BY client_ip
      )
      SELECT
        ah.client_ip,
        ah.hours_active,
        ah.total_requests,
        e.user_agent,
        e.asn_org,
        e.country
      FROM active_hours ah
      JOIN (
        SELECT DISTINCT ON (client_ip)
          client_ip, user_agent, asn_org, country
        FROM events
        WHERE bot_classification = 'human'
      ) e ON ah.client_ip = e.client_ip
      WHERE ah.hours_active > 18  -- Active in >18 different hours of day
        AND ah.total_requests > 50
      ORDER BY ah.hours_active DESC, ah.total_requests DESC
      LIMIT 20;
    `);

    if (timingPatterns.rows.length > 0) {
      console.log(`Found ${timingPatterns.rows.length} "humans" active >18 hours/day:\\n`);
      timingPatterns.rows.forEach(row => {
        console.log(`${row.client_ip.padEnd(18)} Active ${row.hours_active}/24 hours, ${row.total_requests} requests`);
        console.log(`  Country: ${row.country}, ASN: ${(row.asn_org || 'Unknown').substring(0, 50)}`);
        console.log(`  UA: ${(row.user_agent || 'None').substring(0, 80)}...\\n`);
      });
    } else {
      console.log('✓ No suspicious 24/7 activity patterns detected.\\n');
    }

    // Summary
    console.log('\\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));

    const totalHumans = await query(`
      SELECT COUNT(*) as count
      FROM events
      WHERE bot_classification = 'human'
        AND datacenter_provider IS NULL
        AND timestamp > NOW() - INTERVAL '30 days';
    `);

    const suspiciousCount = fastRequests.rows.length +
                           systematicBrowsing.rows.length +
                           timingPatterns.rows.length;

    console.log(`\\nTotal "human" events from residential IPs (30 days): ${totalHumans.rows[0].count}`);
    console.log(`Suspicious patterns detected: ${suspiciousCount}`);
    console.log(`\\nNote: These detections show POTENTIAL AI agents running in browsers.`);
    console.log(`Further investigation of specific IPs recommended.`);

    console.log('\\n' + '='.repeat(80));

    await closeDB();

  } catch (err) {
    console.error('\\n❌ Analysis failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

detectAIAgentsInBrowsers();
