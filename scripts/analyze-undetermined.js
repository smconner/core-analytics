#!/usr/bin/env node
/**
 * Analyze Undetermined Bots
 * Generate a comprehensive report on bot_undetermined traffic
 */

import { initDB, query, closeDB } from '../lib/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

async function analyzeUndetermined() {
  console.log('='.repeat(80));
  console.log('UNDETERMINED BOTS ANALYSIS REPORT');
  console.log('='.repeat(80));

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    initDB(config.database);

    // 1. Overview
    console.log('\n📊 OVERVIEW\n');
    const overview = await query(`
      SELECT
        COUNT(*) as total_requests,
        COUNT(DISTINCT client_ip) as unique_ips,
        COUNT(DISTINCT path) as unique_paths,
        COUNT(DISTINCT site) as sites_affected,
        MIN(timestamp) as first_seen,
        MAX(timestamp) as last_seen,
        COUNT(*) FILTER (WHERE has_sec_fetch_headers = false) as missing_sec_fetch,
        COUNT(*) FILTER (WHERE has_client_hints = false) as missing_client_hints,
        COUNT(*) FILTER (WHERE user_agent IS NULL OR user_agent = '') as no_user_agent,
        COUNT(*) FILTER (WHERE datacenter_provider IS NOT NULL) as from_datacenter
      FROM events
      WHERE bot_classification = 'bot_undetermined';
    `);

    const o = overview.rows[0];
    console.log(`  Total Requests: ${parseInt(o.total_requests).toLocaleString()}`);
    console.log(`  Unique IPs: ${parseInt(o.unique_ips).toLocaleString()}`);
    console.log(`  Unique Paths: ${parseInt(o.unique_paths).toLocaleString()}`);
    console.log(`  Sites Affected: ${o.sites_affected}`);
    console.log(`  Time Range: ${new Date(o.first_seen).toISOString().split('T')[0]} to ${new Date(o.last_seen).toISOString().split('T')[0]}`);
    console.log(`\n  Missing Sec-Fetch Headers: ${parseInt(o.missing_sec_fetch).toLocaleString()} (${(o.missing_sec_fetch/o.total_requests*100).toFixed(1)}%)`);
    console.log(`  Missing Client Hints: ${parseInt(o.missing_client_hints).toLocaleString()} (${(o.missing_client_hints/o.total_requests*100).toFixed(1)}%)`);
    console.log(`  No User-Agent: ${parseInt(o.no_user_agent).toLocaleString()} (${(o.no_user_agent/o.total_requests*100).toFixed(1)}%)`);
    console.log(`  From Datacenters: ${parseInt(o.from_datacenter).toLocaleString()} (${(o.from_datacenter/o.total_requests*100).toFixed(1)}%)`);

    // 2. Top IPs
    console.log('\n\n🔝 TOP 20 IPs (by request count)\n');
    const topIPs = await query(`
      SELECT
        client_ip,
        COUNT(*) as request_count,
        COUNT(DISTINCT path) as unique_paths,
        MAX(user_agent) as sample_ua,
        MAX(datacenter_provider) as datacenter,
        MAX(country) as country,
        MAX(city) as city,
        has_sec_fetch_headers,
        has_client_hints
      FROM events
      WHERE bot_classification = 'bot_undetermined'
      GROUP BY client_ip, has_sec_fetch_headers, has_client_hints
      ORDER BY request_count DESC
      LIMIT 20;
    `);

    topIPs.rows.forEach((row, i) => {
      const ua = row.sample_ua ? row.sample_ua.substring(0, 60) + '...' : 'None';
      console.log(`  ${(i+1).toString().padStart(2)}. ${row.client_ip.padEnd(15)} - ${String(row.request_count).padStart(5)} requests, ${String(row.unique_paths).padStart(3)} paths`);
      console.log(`      Location: ${row.city || 'Unknown'}, ${row.country || 'Unknown'}`);
      console.log(`      Datacenter: ${row.datacenter || 'None (residential)'}`);
      console.log(`      Sec-Fetch: ${row.has_sec_fetch_headers ? 'Yes' : 'No'}, Client Hints: ${row.has_client_hints ? 'Yes' : 'No'}`);
      console.log(`      UA: ${ua}`);
      console.log('');
    });

    // 3. Most visited paths
    console.log('\n🔗 TOP 30 MOST VISITED PATHS\n');
    const topPaths = await query(`
      SELECT
        path,
        COUNT(*) as hit_count,
        COUNT(DISTINCT client_ip) as unique_ips,
        MAX(site) as site
      FROM events
      WHERE bot_classification = 'bot_undetermined'
      GROUP BY path
      ORDER BY hit_count DESC
      LIMIT 30;
    `);

    topPaths.rows.forEach((row, i) => {
      console.log(`  ${(i+1).toString().padStart(2)}. [${String(row.hit_count).padStart(4)} hits, ${String(row.unique_ips).padStart(3)} IPs] ${row.site}${row.path}`);
    });

    // 4. User-Agent analysis
    console.log('\n\n🤖 USER-AGENT PATTERNS\n');
    const uaPatterns = await query(`
      SELECT
        CASE
          WHEN user_agent IS NULL OR user_agent = '' THEN 'No User-Agent'
          WHEN user_agent ILIKE '%Chrome%' AND user_agent ILIKE '%Safari%' THEN 'Chrome-like'
          WHEN user_agent ILIKE '%Firefox%' THEN 'Firefox-like'
          WHEN user_agent ILIKE '%Safari%' AND user_agent NOT ILIKE '%Chrome%' THEN 'Safari-like'
          WHEN user_agent ILIKE '%Edge%' THEN 'Edge-like'
          WHEN user_agent ILIKE '%curl%' THEN 'curl'
          WHEN user_agent ILIKE '%wget%' THEN 'wget'
          WHEN user_agent ILIKE '%python%' THEN 'Python'
          WHEN user_agent ILIKE '%java%' THEN 'Java'
          WHEN user_agent ILIKE '%okhttp%' THEN 'OkHttp'
          WHEN user_agent ILIKE '%go-http%' THEN 'Go HTTP Client'
          ELSE 'Other'
        END as ua_pattern,
        COUNT(*) as count,
        COUNT(DISTINCT client_ip) as unique_ips
      FROM events
      WHERE bot_classification = 'bot_undetermined'
      GROUP BY ua_pattern
      ORDER BY count DESC;
    `);

    uaPatterns.rows.forEach(row => {
      console.log(`  ${row.ua_pattern.padEnd(20)} ${String(row.count).padStart(5)} requests from ${String(row.unique_ips).padStart(4)} IPs`);
    });

    // 5. Datacenter breakdown
    console.log('\n\n🏢 DATACENTER BREAKDOWN\n');
    const datacenters = await query(`
      SELECT
        COALESCE(datacenter_provider, 'Residential/Unknown') as provider,
        COUNT(*) as request_count,
        COUNT(DISTINCT client_ip) as unique_ips
      FROM events
      WHERE bot_classification = 'bot_undetermined'
      GROUP BY datacenter_provider
      ORDER BY request_count DESC;
    `);

    datacenters.rows.forEach(row => {
      console.log(`  ${row.provider.padEnd(25)} ${String(row.request_count).padStart(5)} requests from ${String(row.unique_ips).padStart(4)} IPs`);
    });

    // 6. Geographic distribution
    console.log('\n\n🌍 TOP 15 COUNTRIES\n');
    const countries = await query(`
      SELECT
        COALESCE(country, 'Unknown') as country,
        COUNT(*) as request_count,
        COUNT(DISTINCT client_ip) as unique_ips
      FROM events
      WHERE bot_classification = 'bot_undetermined'
      GROUP BY country
      ORDER BY request_count DESC
      LIMIT 15;
    `);

    countries.rows.forEach(row => {
      console.log(`  ${row.country.padEnd(25)} ${String(row.request_count).padStart(5)} requests from ${String(row.unique_ips).padStart(4)} IPs`);
    });

    // 7. Why they're undetermined
    console.log('\n\n❓ WHY UNDETERMINED?\n');
    const reasons = await query(`
      SELECT
        CASE
          WHEN user_agent IS NULL OR user_agent = '' THEN 'No User-Agent'
          WHEN has_sec_fetch_headers = false AND datacenter_provider IS NULL THEN 'Missing Sec-Fetch (residential)'
          WHEN has_sec_fetch_headers = false AND datacenter_provider IS NOT NULL THEN 'Missing Sec-Fetch (datacenter)'
          WHEN has_client_hints = false AND has_sec_fetch_headers = true THEN 'Has Sec-Fetch but no Client Hints'
          ELSE 'Other reasons'
        END as reason,
        COUNT(*) as count
      FROM events
      WHERE bot_classification = 'bot_undetermined'
      GROUP BY reason
      ORDER BY count DESC;
    `);

    reasons.rows.forEach(row => {
      console.log(`  ${row.reason.padEnd(50)} ${String(row.count).padStart(5)} (${(row.count/o.total_requests*100).toFixed(1)}%)`);
    });

    // 8. Temporal patterns
    console.log('\n\n📅 ACTIVITY BY DAY OF WEEK\n');
    const dayOfWeek = await query(`
      SELECT
        TO_CHAR(timestamp, 'Day') as day,
        COUNT(*) as count
      FROM events
      WHERE bot_classification = 'bot_undetermined'
      GROUP BY TO_CHAR(timestamp, 'Day'), EXTRACT(DOW FROM timestamp)
      ORDER BY EXTRACT(DOW FROM timestamp);
    `);

    dayOfWeek.rows.forEach(row => {
      const bar = '█'.repeat(Math.ceil(row.count / 100));
      console.log(`  ${row.day.padEnd(10)} ${String(row.count).padStart(5)} ${bar}`);
    });

    // 9. Sample suspicious behaviors
    console.log('\n\n🚩 SUSPICIOUS PATTERNS (High request rates)\n');
    const suspicious = await query(`
      SELECT
        client_ip,
        COUNT(*) as request_count,
        EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) as duration_seconds,
        COUNT(DISTINCT path) as unique_paths,
        MAX(datacenter_provider) as datacenter,
        MAX(user_agent) as sample_ua
      FROM events
      WHERE bot_classification = 'bot_undetermined'
        AND timestamp > NOW() - INTERVAL '7 days'
      GROUP BY client_ip
      HAVING EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) > 0
        AND (COUNT(*)::float / EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp)))) > 0.1
      ORDER BY (COUNT(*)::float / EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp)))) DESC
      LIMIT 10;
    `);

    if (suspicious.rows.length > 0) {
      suspicious.rows.forEach(row => {
        const rate = (row.request_count / row.duration_seconds).toFixed(2);
        console.log(`  ${row.client_ip.padEnd(15)} ${rate.padStart(6)} req/sec over ${(row.duration_seconds/60).toFixed(0)}min`);
        console.log(`     ${row.request_count} requests, ${row.unique_paths} unique paths`);
        console.log(`     Datacenter: ${row.datacenter || 'None'}`);
        console.log('');
      });
    } else {
      console.log('  No high-rate activity detected in last 7 days');
    }

    console.log('\n' + '='.repeat(80));
    console.log('REPORT COMPLETE');
    console.log('='.repeat(80));

    await closeDB();

  } catch (err) {
    console.error('\n❌ Analysis failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

analyzeUndetermined();
