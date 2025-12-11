#!/usr/bin/env node
/**
 * Comprehensive Bot Reclassification
 * Catches false negatives: IPs misclassified as "human" but exhibiting bot patterns
 */

import { initDB, query, closeDB } from '../lib/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

async function reclassifyAll() {
  console.log('='.repeat(60));
  console.log('Comprehensive Bot Reclassification');
  console.log('='.repeat(60));

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    initDB(config.database);

    let totalUpdated = 0;

    // ========================================================================
    // Pattern 1: Cheap Hosting Providers (automated scraping infrastructure)
    // ========================================================================
    console.log('\n[1] Reclassifying cheap hosting providers...');
    const cheapHostingQuery = `
      UPDATE events
      SET
        bot_classification = 'stealth_ai',
        bot_name = 'Cheap-Hosting-Scraper',
        detection_level = 2
      WHERE bot_classification = 'human'
        AND (
          asn_org ILIKE '%CHEAPY-HOST%' OR
          asn_org ILIKE '%Datacamp Limited%' OR
          asn_org ILIKE '%Servers Tech%' OR
          asn_org ILIKE '%Clouvider%' OR
          asn_org ILIKE '%UK-2 Limited%' OR
          asn_org ILIKE '%GSL Networks%'
        )
      RETURNING client_ip;
    `;
    const cheapResult = await query(cheapHostingQuery);
    console.log(`  ✓ Reclassified ${cheapResult.rowCount} events from cheap hosting`);
    totalUpdated += cheapResult.rowCount;

    // ========================================================================
    // Pattern 2: Burst Rate Detection (>1 req per 5 seconds)
    // ========================================================================
    console.log('\n[2] Finding IPs with burst patterns...');
    const burstQuery = `
      WITH ip_stats AS (
        SELECT
          client_ip,
          COUNT(*) as request_count,
          EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) as duration_seconds,
          MIN(timestamp) as first_seen,
          MAX(timestamp) as last_seen
        FROM events
        WHERE bot_classification = 'human'
          AND timestamp > NOW() - INTERVAL '7 days'
        GROUP BY client_ip
        HAVING COUNT(*) >= 5
          AND EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) > 0
          AND (COUNT(*)::float / EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp)))) > 0.2
      )
      UPDATE events e
      SET
        bot_classification = 'stealth_ai',
        bot_name = 'Burst-Pattern-Bot',
        detection_level = 3
      FROM ip_stats s
      WHERE e.client_ip = s.client_ip
        AND e.bot_classification = 'human'
      RETURNING e.client_ip;
    `;
    const burstResult = await query(burstQuery);
    console.log(`  ✓ Reclassified ${burstResult.rowCount} events with burst patterns`);
    totalUpdated += burstResult.rowCount;

    // ========================================================================
    // Pattern 3: Cloudflare WARP VPN (short sessions from VPN)
    // ========================================================================
    console.log('\n[3] Reclassifying Cloudflare WARP VPN traffic...');
    const warpQuery = `
      WITH warp_ips AS (
        SELECT client_ip
        FROM events
        WHERE bot_classification = 'human'
          AND asn_org = 'Cloudflare, Inc.'
          AND client_ip::text LIKE '2a06:98c0:%'
        GROUP BY client_ip
        HAVING COUNT(*) < 20  -- Short sessions only
          AND EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) < 3600  -- < 1 hour
      )
      UPDATE events e
      SET
        bot_classification = 'stealth_ai',
        bot_name = 'Cloudflare-WARP-Bot',
        detection_level = 2
      FROM warp_ips w
      WHERE e.client_ip = w.client_ip
        AND e.bot_classification = 'human'
      RETURNING e.client_ip;
    `;
    const warpResult = await query(warpQuery);
    console.log(`  ✓ Reclassified ${warpResult.rowCount} Cloudflare WARP events`);
    totalUpdated += warpResult.rowCount;

    // ========================================================================
    // Pattern 4: Tencent Cloud Infrastructure
    // ========================================================================
    console.log('\n[4] Reclassifying Tencent Cloud traffic...');
    const tencentQuery = `
      UPDATE events
      SET
        bot_classification = 'stealth_ai',
        bot_name = 'Tencent-Cloud-Bot',
        detection_level = 2
      WHERE bot_classification = 'human'
        AND asn_org ILIKE '%Tencent%'
      RETURNING client_ip;
    `;
    const tencentResult = await query(tencentQuery);
    console.log(`  ✓ Reclassified ${tencentResult.rowCount} Tencent Cloud events`);
    totalUpdated += tencentResult.rowCount;

    // ========================================================================
    // Pattern 5: Corporate Proxy Networks (Kaspersky, MegaFon, etc.)
    // ========================================================================
    console.log('\n[5] Reclassifying corporate proxy networks...');
    const corpProxyQuery = `
      WITH corp_proxies AS (
        SELECT client_ip
        FROM events
        WHERE bot_classification = 'human'
          AND (
            asn_org ILIKE '%Kaspersky%' OR
            asn_org = 'PJSC MegaFon' OR
            asn_org = 'Rostelecom'
          )
        GROUP BY client_ip
        HAVING COUNT(*) >= 5  -- Multiple requests
          AND EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) < 300  -- < 5 minutes
      )
      UPDATE events e
      SET
        bot_classification = 'web_crawler',
        bot_name = 'Corporate-Proxy-Crawler',
        detection_level = 2
      FROM corp_proxies c
      WHERE e.client_ip = c.client_ip
        AND e.bot_classification = 'human'
      RETURNING e.client_ip;
    `;
    const corpResult = await query(corpProxyQuery);
    console.log(`  ✓ Reclassified ${corpResult.rowCount} corporate proxy events`);
    totalUpdated += corpResult.rowCount;

    // ========================================================================
    // Pattern 6: Remaining Azure/AWS/GCP with burst patterns
    // ========================================================================
    console.log('\n[6] Catching remaining datacenter IPs with any suspicious activity...');
    const datacenterCleanupQuery = `
      WITH datacenter_bursts AS (
        SELECT client_ip, datacenter_provider
        FROM events
        WHERE bot_classification = 'human'
          AND datacenter_provider IS NOT NULL
        GROUP BY client_ip, datacenter_provider
        HAVING COUNT(*) >= 3  -- Even 3+ requests is suspicious for datacenter
      )
      UPDATE events e
      SET
        bot_classification = 'stealth_ai',
        bot_name = UPPER(d.datacenter_provider) || '-Stealth',
        detection_level = 2
      FROM datacenter_bursts d
      WHERE e.client_ip = d.client_ip
        AND e.bot_classification = 'human'
      RETURNING e.client_ip;
    `;
    const datacenterResult = await query(datacenterCleanupQuery);
    console.log(`  ✓ Reclassified ${datacenterResult.rowCount} remaining datacenter events`);
    totalUpdated += datacenterResult.rowCount;

    // ========================================================================
    // Summary
    // ========================================================================
    console.log('\n' + '='.repeat(60));
    console.log(`Total events reclassified: ${totalUpdated}`);
    console.log('='.repeat(60));

    console.log('\nNew classification distribution:');
    const statsQuery = `
      SELECT
        bot_classification,
        COUNT(*) as count,
        ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) as percentage
      FROM events
      GROUP BY bot_classification
      ORDER BY count DESC;
    `;
    const stats = await query(statsQuery);
    stats.rows.forEach(row => {
      console.log(`  ${row.bot_classification.padEnd(20)} ${String(row.count).padStart(6)} (${row.percentage}%)`);
    });

    await closeDB();

  } catch (err) {
    console.error('Reclassification failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

reclassifyAll();
