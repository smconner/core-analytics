#!/usr/bin/env node
/**
 * IP Legitimacy Investigation
 * Analyzes behavioral patterns to determine if IPs are real humans or bots
 */

import { initDB, query, closeDB } from '../lib/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

// IPs to investigate
const INVESTIGATE_IPS = [
  '172.207.9.124',
  '40.113.19.56',
  '218.104.149.184',
  '48.210.57.6',
  '172.192.8.227',
  '130.33.64.66',
  '172.192.26.78',
  '171.120.26.145',
  '146.70.76.58',
  '50.24.28.220'
];

async function investigateIPs() {
  console.log('='.repeat(80));
  console.log('IP LEGITIMACY INVESTIGATION');
  console.log('='.repeat(80));

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    initDB(config.database);

    for (const ip of INVESTIGATE_IPS) {
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`IP: ${ip}`);
      console.log('─'.repeat(80));

      // Get comprehensive behavioral analysis
      const analysisQuery = `
        WITH ip_behavior AS (
          SELECT
            client_ip,
            COUNT(*) as request_count,
            COUNT(DISTINCT path) as unique_paths,
            EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) as duration_seconds,
            MIN(timestamp) as first_seen,
            MAX(timestamp) as last_seen,
            COUNT(*) FILTER (WHERE has_sec_fetch_headers = true) as has_sec_fetch_count,
            COUNT(*) FILTER (WHERE has_client_hints = true) as has_client_hints_count,
            mode() WITHIN GROUP (ORDER BY user_agent) as most_common_ua,
            mode() WITHIN GROUP (ORDER BY site) as most_visited_site,
            MAX(asn_org) as asn_org,
            MAX(datacenter_provider) as datacenter_provider,
            MAX(city) as city,
            MAX(country) as country,
            MAX(bot_classification) as bot_classification,
            MAX(bot_name) as bot_name
          FROM events
          WHERE client_ip = $1
          GROUP BY client_ip
        )
        SELECT
          *,
          CASE
            WHEN duration_seconds > 0 THEN ROUND((request_count::numeric / duration_seconds)::numeric, 4)
            ELSE request_count
          END as requests_per_second
        FROM ip_behavior;
      `;

      const result = await query(analysisQuery, [ip]);

      if (result.rows.length === 0) {
        console.log('❌ NO DATA FOUND');
        continue;
      }

      const data = result.rows[0];

      // Get sample paths (work around array_agg LIMIT issue)
      const pathsQuery = `
        SELECT DISTINCT path
        FROM events
        WHERE client_ip = $1
        ORDER BY path
        LIMIT 10;
      `;
      const pathsResult = await query(pathsQuery, [ip]);
      const samplePaths = pathsResult.rows.map(r => r.path);

      // Calculate legitimacy score
      let legitimacyScore = 0;
      let indicators = [];

      // Factor 1: Request rate (lower is more human)
      const reqPerSec = parseFloat(data.requests_per_second);
      if (reqPerSec < 0.05) {
        legitimacyScore += 25;
        indicators.push('✓ Very slow request rate (human-like)');
      } else if (reqPerSec < 0.2) {
        legitimacyScore += 15;
        indicators.push('⚠ Moderate request rate');
      } else {
        legitimacyScore -= 30;
        indicators.push('✗ High request rate (bot-like)');
      }

      // Factor 2: Sec-Fetch headers (present = real browser)
      const secFetchPct = (data.has_sec_fetch_count / data.request_count) * 100;
      if (secFetchPct > 90) {
        legitimacyScore += 30;
        indicators.push('✓ Sec-Fetch headers present (real browser)');
      } else if (secFetchPct > 50) {
        legitimacyScore += 15;
        indicators.push('⚠ Partial Sec-Fetch headers');
      } else {
        legitimacyScore -= 25;
        indicators.push('✗ Missing Sec-Fetch headers (likely bot)');
      }

      // Factor 3: Client Hints
      const clientHintsPct = (data.has_client_hints_count / data.request_count) * 100;
      if (clientHintsPct > 90) {
        legitimacyScore += 20;
        indicators.push('✓ Client Hints present (modern browser)');
      } else if (clientHintsPct > 50) {
        legitimacyScore += 10;
        indicators.push('⚠ Partial Client Hints');
      } else {
        legitimacyScore -= 15;
        indicators.push('✗ Missing Client Hints');
      }

      // Factor 4: Datacenter vs Residential
      if (data.datacenter_provider) {
        legitimacyScore -= 20;
        indicators.push(`✗ Datacenter IP (${data.datacenter_provider})`);
      } else {
        legitimacyScore += 15;
        indicators.push('✓ Residential/ISP network');
      }

      // Factor 5: Path diversity
      if (data.unique_paths > 5) {
        legitimacyScore += 10;
        indicators.push('✓ Diverse path exploration (curious human)');
      } else if (data.unique_paths <= 2) {
        legitimacyScore -= 10;
        indicators.push('✗ Narrow path targeting (bot-like)');
      }

      // Factor 6: Session duration (longer = more human)
      const durationHours = data.duration_seconds / 3600;
      if (durationHours > 1) {
        legitimacyScore += 10;
        indicators.push('✓ Extended session duration');
      } else if (durationHours < 0.05) {
        legitimacyScore -= 10;
        indicators.push('✗ Very short burst session');
      }

      // Normalize score to 0-100
      legitimacyScore = Math.max(0, Math.min(100, legitimacyScore + 50));

      // Determine verdict
      let verdict = '';
      let emoji = '';
      if (legitimacyScore >= 70) {
        verdict = 'LIKELY REAL HUMAN';
        emoji = '✅';
      } else if (legitimacyScore >= 40) {
        verdict = 'UNCERTAIN / POSSIBLE VPN USER';
        emoji = '⚠️';
      } else {
        verdict = 'LIKELY BOT / AI TRAINING AGENT';
        emoji = '❌';
      }

      // Display results
      console.log(`\n${emoji} VERDICT: ${verdict}`);
      console.log(`📊 Legitimacy Score: ${legitimacyScore.toFixed(0)}/100\n`);

      console.log('METADATA:');
      console.log(`  Location: ${data.city || 'Unknown'}, ${data.country || 'Unknown'}`);
      console.log(`  ASN Org: ${data.asn_org || 'Unknown'}`);
      console.log(`  Datacenter: ${data.datacenter_provider || 'None (residential)'}`);
      console.log(`  Current Classification: ${data.bot_classification || 'Unknown'}`);
      if (data.bot_name) console.log(`  Bot Name: ${data.bot_name}`);

      console.log('\nBEHAVIORAL METRICS:');
      console.log(`  Total Requests: ${data.request_count}`);
      console.log(`  Unique Paths: ${data.unique_paths}`);
      console.log(`  Request Rate: ${reqPerSec.toFixed(4)} req/sec`);
      console.log(`  Session Duration: ${(data.duration_seconds / 60).toFixed(2)} minutes`);
      console.log(`  First Seen: ${new Date(data.first_seen).toISOString()}`);
      console.log(`  Last Seen: ${new Date(data.last_seen).toISOString()}`);

      console.log('\nBROWSER FINGERPRINTS:');
      console.log(`  Sec-Fetch Headers: ${secFetchPct.toFixed(0)}% of requests`);
      console.log(`  Client Hints: ${clientHintsPct.toFixed(0)}% of requests`);
      console.log(`  Most Common Site: ${data.most_visited_site || 'N/A'}`);
      console.log(`  User-Agent: ${data.most_common_ua ? data.most_common_ua.substring(0, 100) + '...' : 'N/A'}`);

      console.log('\nSAMPLE PATHS VISITED:');
      samplePaths.forEach(p => console.log(`  - ${p}`));

      console.log('\nLEGITIMACY INDICATORS:');
      indicators.forEach(ind => console.log(`  ${ind}`));
    }

    console.log('\n' + '='.repeat(80));
    console.log('INVESTIGATION COMPLETE');
    console.log('='.repeat(80));

    await closeDB();

  } catch (err) {
    console.error('Investigation failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

investigateIPs();
