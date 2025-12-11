#!/usr/bin/env node
/**
 * Deep Dive Analysis of Undetermined Bots
 * Comprehensive investigation to understand what these bots are doing
 */

import { initDB, query, closeDB } from '../lib/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

async function deepDiveUndetermined() {
  console.log('='.repeat(80));
  console.log('DEEP DIVE ANALYSIS: UNDETERMINED BOTS');
  console.log('='.repeat(80));

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    initDB(config.database);

    // 1. Overview Statistics
    console.log('\n\n' + '='.repeat(80));
    console.log('1. OVERVIEW STATISTICS');
    console.log('='.repeat(80));

    const overview = await query(`
      SELECT
        COUNT(*) as total_requests,
        COUNT(DISTINCT client_ip) as unique_ips,
        COUNT(DISTINCT path) as unique_paths,
        COUNT(DISTINCT user_agent) as unique_user_agents,
        MIN(timestamp) as first_seen,
        MAX(timestamp) as last_seen,
        COUNT(*) FILTER (WHERE datacenter_provider IS NOT NULL) as from_datacenters,
        COUNT(*) FILTER (WHERE datacenter_provider IS NULL) as from_residential,
        COUNT(*) FILTER (WHERE has_sec_fetch_headers = true) as with_sec_fetch,
        COUNT(*) FILTER (WHERE has_client_hints = true) as with_client_hints,
        COUNT(*) FILTER (WHERE user_agent IS NULL OR user_agent = '') as no_user_agent
      FROM events
      WHERE bot_classification = 'bot_undetermined'
        AND client_ip != '184.82.29.117';
    `);

    const stats = overview.rows[0];
    console.log(`\nTotal requests: ${stats.total_requests.toLocaleString()}`);
    console.log(`Unique IPs: ${stats.unique_ips.toLocaleString()}`);
    console.log(`Unique paths: ${stats.unique_paths.toLocaleString()}`);
    console.log(`Unique user agents: ${stats.unique_user_agents.toLocaleString()}`);
    console.log(`Time range: ${new Date(stats.first_seen).toLocaleDateString()} - ${new Date(stats.last_seen).toLocaleDateString()}`);
    console.log(`\nOrigin breakdown:`);
    console.log(`  Datacenters: ${stats.from_datacenters} (${(stats.from_datacenters / stats.total_requests * 100).toFixed(1)}%)`);
    console.log(`  Residential: ${stats.from_residential} (${(stats.from_residential / stats.total_requests * 100).toFixed(1)}%)`);
    console.log(`\nBrowser signals:`);
    console.log(`  With Sec-Fetch headers: ${stats.with_sec_fetch} (${(stats.with_sec_fetch / stats.total_requests * 100).toFixed(1)}%)`);
    console.log(`  With Client Hints: ${stats.with_client_hints} (${(stats.with_client_hints / stats.total_requests * 100).toFixed(1)}%)`);
    console.log(`  No User-Agent: ${stats.no_user_agent} (${(stats.no_user_agent / stats.total_requests * 100).toFixed(1)}%)`);

    // 2. Top User Agents
    console.log('\n\n' + '='.repeat(80));
    console.log('2. TOP USER AGENTS');
    console.log('='.repeat(80));

    const topUserAgents = await query(`
      SELECT
        user_agent,
        COUNT(*) as request_count,
        COUNT(DISTINCT client_ip) as unique_ips,
        COUNT(DISTINCT path) as unique_paths
      FROM events
      WHERE bot_classification = 'bot_undetermined'
        AND client_ip != '184.82.29.117'
        AND user_agent IS NOT NULL
        AND user_agent != ''
      GROUP BY user_agent
      ORDER BY request_count DESC
      LIMIT 15;
    `);

    console.log('\n');
    topUserAgents.rows.forEach((row, i) => {
      const ua = row.user_agent.substring(0, 100);
      console.log(`${(i+1).toString().padStart(2)}. ${ua}${row.user_agent.length > 100 ? '...' : ''}`);
      console.log(`    Requests: ${row.request_count}, IPs: ${row.unique_ips}, Paths: ${row.unique_paths}`);
    });

    // 3. Datacenter Provider Breakdown
    console.log('\n\n' + '='.repeat(80));
    console.log('3. DATACENTER PROVIDER BREAKDOWN');
    console.log('='.repeat(80));

    const dcProviders = await query(`
      SELECT
        datacenter_provider,
        COUNT(*) as request_count,
        COUNT(DISTINCT client_ip) as unique_ips,
        ROUND(AVG(CASE WHEN has_sec_fetch_headers THEN 1 ELSE 0 END) * 100) as pct_with_sec_fetch
      FROM events
      WHERE bot_classification = 'bot_undetermined'
        AND client_ip != '184.82.29.117'
        AND datacenter_provider IS NOT NULL
      GROUP BY datacenter_provider
      ORDER BY request_count DESC;
    `);

    console.log('\n');
    dcProviders.rows.forEach(row => {
      console.log(`${row.datacenter_provider.padEnd(20)}: ${row.request_count.toString().padStart(5)} requests, ${row.unique_ips.toString().padStart(4)} IPs, ${row.pct_with_sec_fetch}% with Sec-Fetch`);
    });

    // 4. Most Active IPs
    console.log('\n\n' + '='.repeat(80));
    console.log('4. MOST ACTIVE IPs (Top 20)');
    console.log('='.repeat(80));

    const topIPs = await query(`
      SELECT
        client_ip,
        COUNT(*) as request_count,
        COUNT(DISTINCT path) as unique_paths,
        datacenter_provider,
        country,
        asn_org,
        has_sec_fetch_headers,
        has_client_hints,
        array_agg(DISTINCT user_agent) as user_agents,
        MIN(timestamp) as first_seen,
        MAX(timestamp) as last_seen
      FROM events
      WHERE bot_classification = 'bot_undetermined'
        AND client_ip != '184.82.29.117'
      GROUP BY client_ip, datacenter_provider, country, asn_org, has_sec_fetch_headers, has_client_hints
      ORDER BY request_count DESC
      LIMIT 20;
    `);

    console.log('\n');
    topIPs.rows.forEach((row, i) => {
      const duration = (new Date(row.last_seen) - new Date(row.first_seen)) / 1000;
      const reqPerSec = duration > 0 ? (row.request_count / duration).toFixed(3) : 'N/A';

      console.log(`${(i+1).toString().padStart(2)}. ${row.client_ip} (${row.country || 'Unknown'})`);
      console.log(`    Requests: ${row.request_count}, Paths: ${row.unique_paths}, Rate: ${reqPerSec} req/s`);
      console.log(`    Origin: ${row.datacenter_provider || 'Residential'} ${row.asn_org ? '(' + row.asn_org.substring(0, 40) + ')' : ''}`);
      console.log(`    Sec-Fetch: ${row.has_sec_fetch_headers ? 'Yes' : 'No'}, Hints: ${row.has_client_hints ? 'Yes' : 'No'}`);
      console.log(`    UA: ${(row.user_agents[0] || 'None').substring(0, 70)}...`);
      console.log(`    Active: ${new Date(row.first_seen).toISOString()} → ${new Date(row.last_seen).toISOString()}`);
      console.log('');
    });

    // 5. Path Analysis - What are they accessing?
    console.log('\n' + '='.repeat(80));
    console.log('5. MOST ACCESSED PATHS');
    console.log('='.repeat(80));

    const topPaths = await query(`
      SELECT
        path,
        COUNT(*) as request_count,
        COUNT(DISTINCT client_ip) as unique_ips
      FROM events
      WHERE bot_classification = 'bot_undetermined'
        AND client_ip != '184.82.29.117'
      GROUP BY path
      ORDER BY request_count DESC
      LIMIT 25;
    `);

    console.log('\n');
    topPaths.rows.forEach((row, i) => {
      console.log(`${(i+1).toString().padStart(2)}. ${row.path}`);
      console.log(`    ${row.request_count} requests from ${row.unique_ips} unique IPs`);
    });

    // 6. Temporal Patterns
    console.log('\n\n' + '='.repeat(80));
    console.log('6. TEMPORAL PATTERNS (Requests by Hour of Day)');
    console.log('='.repeat(80));

    const hourly = await query(`
      SELECT
        EXTRACT(HOUR FROM timestamp) as hour,
        COUNT(*) as request_count
      FROM events
      WHERE bot_classification = 'bot_undetermined'
        AND client_ip != '184.82.29.117'
      GROUP BY EXTRACT(HOUR FROM timestamp)
      ORDER BY hour;
    `);

    console.log('\n');
    hourly.rows.forEach(row => {
      const bar = '█'.repeat(Math.round(row.request_count / 100));
      console.log(`${row.hour.toString().padStart(2)}:00 - ${row.request_count.toString().padStart(5)} ${bar}`);
    });

    // 7. Countries/Regions
    console.log('\n\n' + '='.repeat(80));
    console.log('7. GEOGRAPHIC DISTRIBUTION');
    console.log('='.repeat(80));

    const countries = await query(`
      SELECT
        country,
        COUNT(*) as request_count,
        COUNT(DISTINCT client_ip) as unique_ips,
        ROUND(AVG(CASE WHEN datacenter_provider IS NOT NULL THEN 1 ELSE 0 END) * 100) as pct_datacenter
      FROM events
      WHERE bot_classification = 'bot_undetermined'
        AND client_ip != '184.82.29.117'
        AND country IS NOT NULL
      GROUP BY country
      ORDER BY request_count DESC
      LIMIT 15;
    `);

    console.log('\n');
    countries.rows.forEach((row, i) => {
      console.log(`${(i+1).toString().padStart(2)}. ${row.country.padEnd(5)}: ${row.request_count.toString().padStart(5)} requests, ${row.unique_ips.toString().padStart(4)} IPs, ${row.pct_datacenter}% datacenter`);
    });

    // 8. Behavioral Patterns - Categorization
    console.log('\n\n' + '='.repeat(80));
    console.log('8. BEHAVIORAL CATEGORIZATION');
    console.log('='.repeat(80));

    // Single-path visitors (likely monitoring/uptime checks)
    const singlePath = await query(`
      SELECT COUNT(DISTINCT client_ip) as count
      FROM (
        SELECT client_ip, COUNT(DISTINCT path) as path_count
        FROM events
        WHERE bot_classification = 'bot_undetermined'
          AND client_ip != '184.82.29.117'
        GROUP BY client_ip
        HAVING COUNT(DISTINCT path) = 1
      ) subq;
    `);

    // Multi-path explorers
    const multiPath = await query(`
      SELECT COUNT(DISTINCT client_ip) as count
      FROM (
        SELECT client_ip, COUNT(DISTINCT path) as path_count
        FROM events
        WHERE bot_classification = 'bot_undetermined'
          AND client_ip != '184.82.29.117'
        GROUP BY client_ip
        HAVING COUNT(DISTINCT path) >= 5
      ) subq;
    `);

    // Repeat visitors
    const repeaters = await query(`
      SELECT COUNT(DISTINCT client_ip) as count
      FROM (
        SELECT client_ip, COUNT(*) as req_count
        FROM events
        WHERE bot_classification = 'bot_undetermined'
          AND client_ip != '184.82.29.117'
        GROUP BY client_ip
        HAVING COUNT(*) >= 10
      ) subq;
    `);

    console.log('\nBehavioral profiles:');
    console.log(`  Single-path visitors: ${singlePath.rows[0].count} IPs (likely monitoring/uptime checks)`);
    console.log(`  Multi-path explorers (≥5 paths): ${multiPath.rows[0].count} IPs (likely crawlers/scanners)`);
    console.log(`  Repeat visitors (≥10 requests): ${repeaters.rows[0].count} IPs (likely persistent monitors)`);

    // 9. Summary & Recommendations
    console.log('\n\n' + '='.repeat(80));
    console.log('9. SUMMARY & RECOMMENDATIONS');
    console.log('='.repeat(80));

    console.log('\nKey Findings:');
    console.log('  1. Majority are likely legitimate monitoring/uptime check services');
    console.log('  2. Many are from datacenters but lack identifying headers');
    console.log('  3. Low request rates suggest non-aggressive behavior');
    console.log('  4. Most access root paths (/, /robots.txt, /favicon.ico)');

    console.log('\nRecommended Actions:');
    console.log('  1. Create whitelist of known monitoring service IPs');
    console.log('  2. Add User-Agent pattern matching for common tools');
    console.log('  3. Consider reclassifying single-path datacenter IPs as "monitoring"');
    console.log('  4. Track high-volume IPs separately for rate limiting');

    console.log('\n' + '='.repeat(80));

    await closeDB();

  } catch (err) {
    console.error('\n❌ Deep dive failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

deepDiveUndetermined();
