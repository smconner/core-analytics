#!/usr/bin/env node
/**
 * Reclassify Events with Expanded ASN List
 * Re-detect datacenter providers using new ASN mappings and pattern matching
 */

import { initDB, query, closeDB } from '../lib/db.js';
import { initASN, lookupASN } from '../lib/asn-lookup.js';
import { classify } from '../lib/ai-classifier-v2.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

async function reclassifyWithExpandedASN() {
  console.log('='.repeat(80));
  console.log('RECLASSIFY WITH EXPANDED ASN LIST');
  console.log('='.repeat(80));

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    initDB(config.database);
    await initASN(config.geoip.asn_db);

    // Get current stats
    console.log('\n📊 BEFORE RECLASSIFICATION:\n');
    const beforeStats = await query(`
      SELECT
        bot_classification,
        COUNT(*) as count,
        ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) as percentage
      FROM events
      GROUP BY bot_classification
      ORDER BY count DESC;
    `);
    beforeStats.rows.forEach(row => {
      console.log(`  ${row.bot_classification.padEnd(30)} ${String(row.count).padStart(6)} (${row.percentage}%)`);
    });

    // Find events that need reclassification
    console.log('\n🔍 Finding events that may need reclassification...\n');

    const eventsQuery = `
      SELECT
        id,
        client_ip,
        user_agent,
        path,
        asn,
        asn_org,
        datacenter_provider as old_datacenter,
        bot_classification as old_classification,
        has_sec_fetch_headers,
        has_client_hints
      FROM events
      WHERE datacenter_provider IS NULL
        AND asn IS NOT NULL
      ORDER BY timestamp DESC;
    `;

    const events = await query(eventsQuery);
    console.log(`  Found ${events.rows.length} events to check`);

    // Process in batches
    const BATCH_SIZE = 1000;
    let processed = 0;
    let datacenterDetected = 0;
    let reclassified = 0;
    const startTime = Date.now();

    console.log('\n🔄 Re-checking datacenter status...\n');

    for (let i = 0; i < events.rows.length; i += BATCH_SIZE) {
      const batch = events.rows.slice(i, i + BATCH_SIZE);

      for (const event of batch) {
        // Re-lookup ASN with new expanded list
        const asnData = lookupASN(event.client_ip);

        // If now detected as datacenter
        if (asnData.datacenter_provider && !event.old_datacenter) {
          datacenterDetected++;

          // Update datacenter_provider in database
          await query(`
            UPDATE events
            SET datacenter_provider = $1
            WHERE id = $2;
          `, [asnData.datacenter_provider, event.id]);

          // Re-classify if it was previously marked as human
          if (event.old_classification === 'human' || event.old_classification === 'bot_undetermined') {
            // Build headers from flags
            const headers = {};
            if (event.has_sec_fetch_headers) {
              headers['Sec-Fetch-Site'] = 'none';
            }
            if (event.has_client_hints) {
              headers['Sec-Ch-Ua'] = '"Chrome";v="120"';
            }

            // Reclassify
            const classification = await classify({
              client_ip: event.client_ip,
              user_agent: event.user_agent,
              path: event.path,
              headers: headers,
              datacenter_provider: asnData.datacenter_provider
            });

            // Update if classification changed
            if (classification.bot_classification !== event.old_classification) {
              await query(`
                UPDATE events
                SET
                  bot_classification = $1,
                  bot_name = $2,
                  detection_level = $3,
                  is_bot = $4
                WHERE id = $5;
              `, [
                classification.bot_classification,
                classification.bot_name,
                classification.detection_level,
                classification.is_bot,
                event.id
              ]);
              reclassified++;
            }
          }
        }

        processed++;
      }

      // Progress update
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = (events.rows.length - processed) / rate;
      process.stdout.write(`\r  Processed: ${processed}/${events.rows.length} - Datacenter detected: ${datacenterDetected} - Reclassified: ${reclassified} - ${rate.toFixed(0)} events/sec - ETA: ${Math.ceil(remaining)}s    `);
    }

    console.log('\n\n✅ Reclassification complete!\n');
    console.log(`  Total processed: ${processed}`);
    console.log(`  Datacenter detected: ${datacenterDetected}`);
    console.log(`  Reclassified: ${reclassified}`);

    // Get new stats
    console.log('\n📊 AFTER RECLASSIFICATION:\n');
    const afterStats = await query(`
      SELECT
        bot_classification,
        COUNT(*) as count,
        ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) as percentage
      FROM events
      GROUP BY bot_classification
      ORDER BY count DESC;
    `);
    afterStats.rows.forEach(row => {
      console.log(`  ${row.bot_classification.padEnd(30)} ${String(row.count).padStart(6)} (${row.percentage}%)`);
    });

    // Show what providers were detected
    console.log('\n🏢 NEWLY DETECTED DATACENTER PROVIDERS:\n');
    const providersDetected = await query(`
      SELECT
        datacenter_provider,
        COUNT(*) as count,
        COUNT(DISTINCT client_ip) as unique_ips,
        array_agg(DISTINCT asn_org) as orgs
      FROM events
      WHERE datacenter_provider IN ('tencent', 'alibaba', 'huawei', 'baidu', 'telecom-cloud', 'hosting')
      GROUP BY datacenter_provider
      ORDER BY count DESC;
    `);

    if (providersDetected.rows.length > 0) {
      providersDetected.rows.forEach(row => {
        console.log(`  ${row.datacenter_provider.padEnd(20)} ${String(row.count).padStart(5)} requests from ${String(row.unique_ips).padStart(4)} IPs`);
        row.orgs.slice(0, 2).forEach(org => {
          console.log(`    - ${org.substring(0, 70)}`);
        });
      });
    } else {
      console.log('  No new datacenter providers detected (already classified)');
    }

    console.log('\n' + '='.repeat(80));

    await closeDB();

  } catch (err) {
    console.error('\n❌ Reclassification failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

reclassifyWithExpandedASN();
