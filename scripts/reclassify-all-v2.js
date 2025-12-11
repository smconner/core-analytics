#!/usr/bin/env node
/**
 * Reclassify All Events Using V2 Classifier
 * Applies the new systematic 4-stage classification to all existing data
 */

import { initDB, query, closeDB } from '../lib/db.js';
import { classify } from '../lib/ai-classifier-v2.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

async function reclassifyAll() {
  console.log('='.repeat(80));
  console.log('RECLASSIFYING ALL EVENTS WITH V2 CLASSIFIER');
  console.log('='.repeat(80));

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    initDB(config.database);

    // Get current statistics
    console.log('\n📊 Current Distribution:');
    const currentStats = await query(`
      SELECT
        bot_classification,
        COUNT(*) as count,
        ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) as percentage
      FROM events
      GROUP BY bot_classification
      ORDER BY count DESC;
    `);
    currentStats.rows.forEach(row => {
      console.log(`  ${row.bot_classification.padEnd(20)} ${String(row.count).padStart(6)} (${row.percentage}%)`);
    });

    // Fetch all unique combinations of classification inputs
    console.log('\n🔍 Fetching events for reclassification...');
    const eventsQuery = `
      SELECT
        id,
        client_ip,
        user_agent,
        path,
        datacenter_provider,
        has_sec_fetch_headers,
        has_client_hints,
        bot_classification as old_classification,
        bot_name as old_bot_name
      FROM events
      ORDER BY timestamp DESC;
    `;

    const events = await query(eventsQuery);
    console.log(`  Found ${events.rows.length} events to reclassify`);

    // Process in batches
    const BATCH_SIZE = 1000;
    let processed = 0;
    let updated = 0;
    const startTime = Date.now();

    console.log('\n🔄 Reclassifying...');

    for (let i = 0; i < events.rows.length; i += BATCH_SIZE) {
      const batch = events.rows.slice(i, i + BATCH_SIZE);
      const updates = [];

      for (const event of batch) {
        // Build headers object from boolean flags
        const headers = {};
        if (event.has_sec_fetch_headers) {
          headers['Sec-Fetch-Site'] = 'none';
        }
        if (event.has_client_hints) {
          headers['Sec-Ch-Ua'] = '"Chrome";v="120"';
        }

        // Classify using V2
        const classification = await classify({
          client_ip: event.client_ip,
          user_agent: event.user_agent,
          path: event.path,
          headers: headers,
          datacenter_provider: event.datacenter_provider
        });

        // Only update if classification changed
        if (classification.bot_classification !== event.old_classification ||
            classification.bot_name !== event.old_bot_name) {
          updates.push({
            id: event.id,
            bot_classification: classification.bot_classification,
            bot_name: classification.bot_name,
            detection_level: classification.detection_level,
            is_bot: classification.is_bot
          });
          updated++;
        }

        processed++;
      }

      // Bulk update this batch
      if (updates.length > 0) {
        for (const update of updates) {
          await query(`
            UPDATE events
            SET
              bot_classification = $1,
              bot_name = $2,
              detection_level = $3,
              is_bot = $4
            WHERE id = $5;
          `, [
            update.bot_classification,
            update.bot_name,
            update.detection_level,
            update.is_bot,
            update.id
          ]);
        }
      }

      // Progress update
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = (events.rows.length - processed) / rate;
      process.stdout.write(`\r  Processed: ${processed}/${events.rows.length} (${updated} updated) - ${rate.toFixed(0)} events/sec - ETA: ${Math.ceil(remaining)}s    `);
    }

    console.log('\n\n✅ Reclassification complete!');
    console.log(`  Total processed: ${processed}`);
    console.log(`  Total updated: ${updated}`);
    console.log(`  Unchanged: ${processed - updated}`);

    // Get new statistics
    console.log('\n📊 New Distribution:');
    const newStats = await query(`
      SELECT
        bot_classification,
        COUNT(*) as count,
        ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) as percentage
      FROM events
      GROUP BY bot_classification
      ORDER BY count DESC;
    `);
    newStats.rows.forEach(row => {
      console.log(`  ${row.bot_classification.padEnd(30)} ${String(row.count).padStart(6)} (${row.percentage}%)`);
    });

    // Show attack traffic breakdown
    console.log('\n🚨 Attack Traffic Breakdown:');
    const attackStats = await query(`
      SELECT
        bot_classification,
        COUNT(*) as count,
        COUNT(DISTINCT client_ip) as unique_ips
      FROM events
      WHERE bot_classification LIKE 'attack_%'
      GROUP BY bot_classification
      ORDER BY count DESC;
    `);
    if (attackStats.rows.length > 0) {
      attackStats.rows.forEach(row => {
        console.log(`  ${row.bot_classification.padEnd(30)} ${String(row.count).padStart(6)} requests from ${row.unique_ips} IPs`);
      });
    } else {
      console.log('  No attack traffic detected');
    }

    // Show human verification stats
    console.log('\n👤 Human Verification:');
    const humanStats = await query(`
      SELECT
        COUNT(*) FILTER (WHERE bot_classification = 'human' AND has_sec_fetch_headers = true) as humans_with_sec_fetch,
        COUNT(*) FILTER (WHERE bot_classification = 'human' AND has_sec_fetch_headers = false) as humans_without_sec_fetch,
        COUNT(*) FILTER (WHERE bot_classification = 'human' AND datacenter_provider IS NOT NULL) as humans_from_datacenter
      FROM events;
    `);
    const hs = humanStats.rows[0];
    console.log(`  Humans with Sec-Fetch: ${hs.humans_with_sec_fetch}`);
    console.log(`  Humans without Sec-Fetch: ${hs.humans_without_sec_fetch}`);
    console.log(`  Humans from datacenter: ${hs.humans_from_datacenter}`);

    if (parseInt(hs.humans_from_datacenter) > 0) {
      console.log('\n  ⚠️  WARNING: Some humans are from datacenters (should be 0 with V2)');
    }
    if (parseInt(hs.humans_without_sec_fetch) > 0) {
      console.log('\n  ⚠️  WARNING: Some humans missing Sec-Fetch headers (should be 0 with V2)');
    }

    console.log('\n' + '='.repeat(80));

    await closeDB();

  } catch (err) {
    console.error('\n❌ Reclassification failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

reclassifyAll();
