#!/usr/bin/env node
/**
 * Investigate Suspicious IPs with Hosting ASNs but Marked as Human
 * These IPs have Sec-Fetch headers (real browser) but from hosting providers
 */

import { initDB, query, closeDB } from '../lib/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

// Known hosting/datacenter patterns
const HOSTING_KEYWORDS = [
  'QUICKPACKET', 'M247', 'JSC Selectel', 'Detai Prosperous',
  'PUREVOLTAGE', 'TZULO', 'AS-SPRIO', 'hosting', 'datacenter',
  'server', 'cloud', 'vps'
];

async function investigateSuspiciousIPs() {
  console.log('='.repeat(80));
  console.log('INVESTIGATING SUSPICIOUS IPs FROM HOSTING PROVIDERS');
  console.log('='.repeat(80));
  console.log('\nThese IPs have:');
  console.log('  ✓ Legitimate Sec-Fetch headers (real browser)');
  console.log('  ✓ Legitimate Client Hints (real browser)');
  console.log('  ✓ Currently classified as HUMAN');
  console.log('  ⚠️  BUT from hosting/datacenter ASNs');
  console.log('\nThis could indicate:');
  console.log('  - Residential proxies (legitimate traffic routed through datacenters)');
  console.log('  - Headful browser automation (Puppeteer/Selenium in real browsers)');
  console.log('  - VPN/proxy services');
  console.log('  - AI agents running in real browsers on cloud servers');

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    initDB(config.database);

    // Find all "human" traffic from suspicious ASN organizations
    console.log('\n\n' + '='.repeat(80));
    console.log('ANALYSIS: HUMANS FROM HOSTING PROVIDERS');
    console.log('='.repeat(80));

    const suspiciousASNs = await query(`
      SELECT
        asn_org,
        COUNT(*) as request_count,
        COUNT(DISTINCT client_ip) as unique_ips,
        COUNT(DISTINCT path) as unique_paths,
        array_agg(DISTINCT client_ip) as sample_ips,
        bool_and(has_sec_fetch_headers) as all_have_sec_fetch,
        bool_and(has_client_hints) as all_have_hints
      FROM events
      WHERE bot_classification = 'human'
        AND datacenter_provider IS NULL
        AND asn_org IS NOT NULL
        AND (
          asn_org ILIKE '%quickpacket%'
          OR asn_org ILIKE '%m247%'
          OR asn_org ILIKE '%selectel%'
          OR asn_org ILIKE '%detai%'
          OR asn_org ILIKE '%purevoltage%'
          OR asn_org ILIKE '%tzulo%'
          OR asn_org ILIKE '%sprio%'
          OR asn_org ILIKE '%hosting%'
          OR asn_org ILIKE '%datacenter%'
          OR asn_org ILIKE '%server%'
          OR asn_org ILIKE '%cloud%'
          OR asn_org ILIKE '%vps%'
        )
      GROUP BY asn_org
      ORDER BY request_count DESC;
    `);

    if (suspiciousASNs.rows.length === 0) {
      console.log('\n✓ No suspicious hosting provider traffic found.\n');
    } else {
      console.log(`\nFound ${suspiciousASNs.rows.length} hosting providers with "human" traffic:\n`);

      suspiciousASNs.rows.forEach(row => {
        console.log(`📍 ${row.asn_org}`);
        console.log(`   Requests: ${row.request_count}, IPs: ${row.unique_ips}, Paths: ${row.unique_paths}`);
        console.log(`   Sec-Fetch: ${row.all_have_sec_fetch ? 'ALL' : 'SOME'}, Client Hints: ${row.all_have_hints ? 'ALL' : 'SOME'}`);
        console.log(`   Sample IPs: ${row.sample_ips.slice(0, 3).join(', ')}`);
        console.log('');
      });
    }

    // Detailed analysis of top suspicious IPs
    console.log('\n' + '='.repeat(80));
    console.log('DETAILED ANALYSIS: TOP SUSPICIOUS IPs');
    console.log('='.repeat(80));

    const detailedIPs = await query(`
      SELECT
        client_ip,
        asn_org,
        COUNT(*) as request_count,
        COUNT(DISTINCT path) as unique_paths,
        array_agg(DISTINCT path ORDER BY path) as all_paths,
        array_agg(DISTINCT user_agent) as user_agents,
        MIN(timestamp) as first_seen,
        MAX(timestamp) as last_seen,
        EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) as duration_seconds,
        has_sec_fetch_headers,
        has_client_hints,
        country
      FROM events
      WHERE bot_classification = 'human'
        AND datacenter_provider IS NULL
        AND asn_org IS NOT NULL
        AND (
          asn_org ILIKE '%quickpacket%'
          OR asn_org ILIKE '%m247%'
          OR asn_org ILIKE '%selectel%'
          OR asn_org ILIKE '%detai%'
          OR asn_org ILIKE '%purevoltage%'
          OR asn_org ILIKE '%tzulo%'
          OR asn_org ILIKE '%sprio%'
        )
      GROUP BY client_ip, asn_org, has_sec_fetch_headers, has_client_hints, country
      ORDER BY request_count DESC
      LIMIT 10;
    `);

    detailedIPs.rows.forEach((row, i) => {
      console.log(`\n${i+1}. IP: ${row.client_ip} (${row.country})`);
      console.log(`   ASN: ${row.asn_org}`);
      console.log(`   Requests: ${row.request_count}, Unique Paths: ${row.unique_paths}`);
      console.log(`   Duration: ${Math.round(row.duration_seconds)}s (${(row.request_count / Math.max(row.duration_seconds, 1)).toFixed(3)} req/s)`);
      console.log(`   First: ${new Date(row.first_seen).toISOString()}`);
      console.log(`   Last: ${new Date(row.last_seen).toISOString()}`);
      console.log(`   Sec-Fetch: ${row.has_sec_fetch_headers ? 'Yes' : 'No'}, Client Hints: ${row.has_client_hints ? 'Yes' : 'No'}`);
      console.log(`   User-Agent: ${(row.user_agents[0] || 'None').substring(0, 80)}...`);
      console.log(`   Paths visited:`);
      row.all_paths.slice(0, 5).forEach(p => {
        console.log(`     - ${p}`);
      });
      if (row.all_paths.length > 5) {
        console.log(`     ... and ${row.all_paths.length - 5} more`);
      }
    });

    // Summary & Recommendations
    console.log('\n\n' + '='.repeat(80));
    console.log('RECOMMENDATIONS');
    console.log('='.repeat(80));
    console.log('\n1. ADD THESE ASNs TO DATACENTER_ASN MAP:');
    console.log('   These are confirmed hosting providers and should be tracked.\n');

    suspiciousASNs.rows.forEach(row => {
      const asnMatch = row.asn_org.match(/AS(\d+)/);
      if (asnMatch) {
        console.log(`   ${asnMatch[1]}: 'hosting', // ${row.asn_org.substring(0, 60)}`);
      }
    });

    console.log('\n2. INVESTIGATE FURTHER:');
    console.log('   - Check if these are residential proxies (legitimate)');
    console.log('   - Verify browser fingerprints match real browsers');
    console.log('   - Look for automated behavior patterns');

    console.log('\n3. POSSIBLE CLASSIFICATIONS:');
    console.log('   - If residential proxies → Keep as human (legitimate)');
    console.log('   - If browser automation → Reclassify as ai_stealth or bot_undetermined');
    console.log('   - If VPN/proxy services → Track separately (legitimate privacy tools)');

    console.log('\n' + '='.repeat(80));

    await closeDB();

  } catch (err) {
    console.error('\n❌ Investigation failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

investigateSuspiciousIPs();
