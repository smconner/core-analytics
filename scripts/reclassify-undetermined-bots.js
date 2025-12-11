#!/usr/bin/env node
/**
 * Reclassify Undetermined Bots with Improved Detection
 * Apply new classifier rules to catch:
 * - HeadlessChrome browsers
 * - Single-path datacenter IPs (monitoring)
 * - Azure multi-path crawlers (systematic)
 * - Cloudflare verification requests
 */

import { initDB, query, closeDB } from '../lib/db.js';
import { classify } from '../lib/ai-classifier-v2.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

async function reclassifyUndetermined() {
  console.log('='.repeat(80));
  console.log('RECLASSIFYING UNDETERMINED BOTS WITH IMPROVED DETECTION');
  console.log('='.repeat(80));

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    initDB(config.database);

    // Get all undetermined bot events
    console.log('\nFetching undetermined bot events...\n');

    const events = await query(`
      SELECT
        id,
        client_ip,
        user_agent,
        path,
        datacenter_provider,
        has_sec_fetch_headers,
        has_client_hints,
        bot_classification,
        bot_name
      FROM events
      WHERE bot_classification = 'bot_undetermined'
        AND client_ip NOT IN ('184.82.29.117', '123.25.101.101')
      ORDER BY timestamp DESC;
    `);

    console.log(`Found ${events.rows.length} undetermined bot events\n`);

    if (events.rows.length === 0) {
      console.log('✓ No events to reclassify\n');
      await closeDB();
      return;
    }

    let reclassified = 0;
    let unchanged = 0;
    const classificationChanges = {};
    const botNameChanges = {};

    console.log('Re-classifying events with updated rules...\n');

    for (const event of events.rows) {
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

      // Re-classify with updated rules
      const result = await classify({
        client_ip: event.client_ip,
        user_agent: event.user_agent,
        path: event.path,
        headers: headers,
        datacenter_provider: event.datacenter_provider
      });

      const newClassification = result.bot_classification;
      const newBotName = result.bot_name;

      if (newClassification !== event.bot_classification) {
        // Update the classification
        await query(`
          UPDATE events
          SET bot_classification = $1, bot_name = $2, is_bot = $3
          WHERE id = $4;
        `, [
          newClassification,
          newBotName,
          newClassification !== 'human',
          event.id
        ]);

        reclassified++;

        // Track classification changes
        const key = `${event.bot_classification} → ${newClassification}`;
        classificationChanges[key] = (classificationChanges[key] || 0) + 1;

        // Track bot name changes
        if (newBotName) {
          botNameChanges[newBotName] = (botNameChanges[newBotName] || 0) + 1;
        }

        if (reclassified <= 10) {
          console.log(`  ${event.client_ip} - ${event.path || '/'}`);
          console.log(`    ${event.bot_classification} → ${newClassification}`);
          console.log(`    Bot: ${newBotName || 'N/A'}`);
          console.log(`    Reason: ${result.detection_reason}`);
          console.log('');
        }
      } else {
        unchanged++;
      }

      // Progress indicator
      if ((reclassified + unchanged) % 100 === 0) {
        console.log(`Progress: ${reclassified + unchanged}/${events.rows.length} events processed...`);
      }
    }

    if (reclassified > 10) {
      console.log(`  ... and ${reclassified - 10} more\n`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('RECLASSIFICATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`\nTotal events processed: ${events.rows.length}`);
    console.log(`Events reclassified: ${reclassified}`);
    console.log(`Events unchanged: ${unchanged}`);

    if (Object.keys(classificationChanges).length > 0) {
      console.log('\nClassification changes:');
      Object.entries(classificationChanges)
        .sort((a, b) => b[1] - a[1])
        .forEach(([change, count]) => {
          console.log(`  ${change}: ${count} events`);
        });
    }

    if (Object.keys(botNameChanges).length > 0) {
      console.log('\nNew bot names assigned:');
      Object.entries(botNameChanges)
        .sort((a, b) => b[1] - a[1])
        .forEach(([name, count]) => {
          console.log(`  ${name}: ${count} events`);
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
        ROUND(COUNT(*)::numeric / (SELECT COUNT(*) FROM events WHERE client_ip NOT IN ('184.82.29.117', '123.25.101.101'))::numeric * 100, 1) as percentage
      FROM events
      WHERE client_ip NOT IN ('184.82.29.117', '123.25.101.101')
      GROUP BY bot_classification
      ORDER BY count DESC;
    `);

    console.log('\nCurrent distribution:');
    stats.rows.forEach(row => {
      const classification = row.bot_classification || 'null';
      console.log(`  ${classification.padEnd(25)}: ${row.count.toString().padStart(6)} (${row.percentage}%)`);
    });

    console.log('\n' + '='.repeat(80));

    await closeDB();

  } catch (err) {
    console.error('\n❌ Reclassification failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

reclassifyUndetermined();
