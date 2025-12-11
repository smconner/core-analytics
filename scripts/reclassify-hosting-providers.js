#!/usr/bin/env node
/**
 * Reclassify Traffic from Newly Detected Hosting Providers
 * These were browser automation detected as "human" but are from hosting ASNs
 */

import { initDB, query, closeDB } from '../lib/db.js';
import { classify } from '../lib/ai-classifier-v2.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

// New hosting ASNs we just added
const NEW_HOSTING_ASNS = [9009, 46261, 212512, 11878, 49505, 50340, 26548, 64267];

async function reclassifyHostingProviders() {
  console.log('='.repeat(80));
  console.log('RECLASSIFYING TRAFFIC FROM NEWLY DETECTED HOSTING PROVIDERS');
  console.log('='.repeat(80));
  console.log('\nNew hosting ASNs added:', NEW_HOSTING_ASNS.join(', '));

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    initDB(config.database);

    // Find all events from these ASNs
    console.log('\n\nFinding events from new hosting providers...');

    const events = await query(`
      SELECT
        id,
        client_ip,
        user_agent,
        path,
        has_sec_fetch_headers,
        has_client_hints,
        bot_classification,
        asn,
        asn_org
      FROM events
      WHERE asn = ANY($1::int[])
      ORDER BY timestamp DESC;
    `, [NEW_HOSTING_ASNS]);

    console.log(`Found ${events.rows.length} events from these hosting providers\n`);

    if (events.rows.length === 0) {
      console.log('✓ No events to reclassify\n');
      await closeDB();
      return;
    }

    // Update datacenter_provider for all these events
    console.log('Step 1: Updating datacenter_provider to "hosting"...');

    const updateResult = await query(`
      UPDATE events
      SET datacenter_provider = 'hosting'
      WHERE asn = ANY($1::int[])
        AND (datacenter_provider IS NULL OR datacenter_provider = '');
    `, [NEW_HOSTING_ASNS]);

    console.log(`✓ Updated ${updateResult.rowCount} events with datacenter_provider = 'hosting'\n`);

    // Re-classify events that were marked as "human"
    console.log('Step 2: Re-classifying events previously marked as "human"...\n');

    const humanEvents = events.rows.filter(e => e.bot_classification === 'human');
    console.log(`Found ${humanEvents.length} "human" events to reclassify`);

    let reclassified = 0;
    let unchanged = 0;
    const classificationChanges = {};

    for (const event of humanEvents) {
      // Rebuild headers object from boolean flags
      const headers = {};

      if (event.has_sec_fetch_headers) {
        headers['Sec-Fetch-Site'] = 'none';
        headers['Sec-Fetch-Mode'] = 'navigate';
        headers['Sec-Fetch-Dest'] = 'document';
      }

      if (event.has_client_hints) {
        headers['Sec-Ch-Ua'] = '"Chrome";v="120"';
        headers['Sec-Ch-Ua-Mobile'] = '?0';
      }

      // Re-classify with datacenter_provider now set to 'hosting'
      const result = await classify({
        client_ip: event.client_ip,
        user_agent: event.user_agent,
        path: event.path,
        headers: headers,
        datacenter_provider: 'hosting'
      });

      const newClassification = result.bot_classification;

      if (newClassification !== event.bot_classification) {
        // Update the classification
        await query(`
          UPDATE events
          SET bot_classification = $1, is_bot = $2
          WHERE id = $3;
        `, [
          newClassification,
          newClassification !== 'human',
          event.id
        ]);

        reclassified++;

        // Track classification changes
        const key = `${event.bot_classification} → ${newClassification}`;
        classificationChanges[key] = (classificationChanges[key] || 0) + 1;

        if (reclassified <= 5) {
          console.log(`  ${event.client_ip} (${event.asn_org})`);
          console.log(`    ${event.bot_classification} → ${newClassification}`);
          console.log(`    Reason: ${result.detection_reason}`);
        }
      } else {
        unchanged++;
      }
    }

    if (reclassified > 5) {
      console.log(`  ... and ${reclassified - 5} more`);
    }

    console.log('\n\n' + '='.repeat(80));
    console.log('RECLASSIFICATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`\nTotal events processed: ${events.rows.length}`);
    console.log(`Events updated with datacenter_provider: ${updateResult.rowCount}`);
    console.log(`Events reclassified: ${reclassified}`);
    console.log(`Events unchanged: ${unchanged}`);

    if (Object.keys(classificationChanges).length > 0) {
      console.log('\nClassification changes:');
      Object.entries(classificationChanges).forEach(([change, count]) => {
        console.log(`  ${change}: ${count} events`);
      });
    }

    // Show updated statistics
    console.log('\n\n' + '='.repeat(80));
    console.log('UPDATED STATISTICS');
    console.log('='.repeat(80));

    const stats = await query(`
      SELECT
        bot_classification,
        COUNT(*) as count,
        ROUND(COUNT(*)::numeric / (SELECT COUNT(*) FROM events WHERE client_ip != '184.82.29.117')::numeric * 100, 1) as percentage
      FROM events
      WHERE client_ip != '184.82.29.117'
      GROUP BY bot_classification
      ORDER BY count DESC;
    `);

    console.log('\nCurrent distribution:');
    stats.rows.forEach(row => {
      const classification = row.bot_classification || 'null';
      console.log(`  ${classification.padEnd(20)}: ${row.count.toString().padStart(6)} (${row.percentage}%)`);
    });

    console.log('\n' + '='.repeat(80));

    await closeDB();

  } catch (err) {
    console.error('\n❌ Reclassification failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

reclassifyHostingProviders();
