#!/usr/bin/env node
/**
 * Reclassify AI Training Agents
 * Retroactively updates bot_classification for existing events
 * that match AI training agent patterns
 */

import { initDB, query, closeDB } from '../lib/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

async function reclassify() {
  console.log('='.repeat(60));
  console.log('Reclassifying AI Training Agents');
  console.log('='.repeat(60));

  try {
    // Load config and initialize DB
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    initDB(config.database);

    console.log('\nStep 1: Finding datacenter IPs misclassified as human...');

    // Find all events that match training agent pattern:
    // Pattern A: Datacenter + browser-like UA + missing Sec-Fetch headers
    // Pattern B: Datacenter + NULL/empty User-Agent (even more suspicious!)
    // Both currently classified as 'human'

    const findQuery = `
      SELECT DISTINCT client_ip, datacenter_provider, user_agent
      FROM events
      WHERE datacenter_provider IS NOT NULL
        AND bot_classification = 'human'
        AND (
          -- Pattern A: Browser-like UA without bot keywords
          (
            user_agent ILIKE '%Mozilla%'
            AND (user_agent ILIKE '%Chrome%' OR user_agent ILIKE '%Safari%' OR user_agent ILIKE '%Firefox%')
            AND user_agent NOT ILIKE '%bot%'
            AND user_agent NOT ILIKE '%crawler%'
            AND user_agent NOT ILIKE '%spider%'
            AND has_sec_fetch_headers = false
          )
          OR
          -- Pattern B: NULL or empty User-Agent (highly suspicious)
          (user_agent IS NULL OR user_agent = '')
        )
      ORDER BY client_ip;
    `;

    const candidates = await query(findQuery);
    console.log(`Found ${candidates.rows.length} IPs matching training agent pattern`);

    if (candidates.rows.length === 0) {
      console.log('No records to reclassify');
      await closeDB();
      return;
    }

    console.log('\nStep 2: Reclassifying matched IPs...');

    let updatedCount = 0;
    for (const row of candidates.rows) {
      const { client_ip, datacenter_provider } = row;

      // Update all events from this IP
      const updateQuery = `
        UPDATE events
        SET
          bot_classification = 'ai_training',
          bot_name = $1,
          detection_level = 3
        WHERE client_ip = $2
          AND bot_classification = 'human'
          AND datacenter_provider IS NOT NULL
          AND has_sec_fetch_headers = false
        RETURNING id;
      `;

      const botName = `${datacenter_provider.toUpperCase()}-Training-Agent`;
      const result = await query(updateQuery, [botName, client_ip]);

      updatedCount += result.rowCount;
      console.log(`  ${client_ip} (${datacenter_provider}): ${result.rowCount} events → ai_training`);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Reclassification complete: ${updatedCount} events updated`);
    console.log('='.repeat(60));

    // Show summary statistics
    console.log('\nNew classification distribution:');
    const statsQuery = `
      SELECT
        bot_classification,
        COUNT(*) as count
      FROM events
      GROUP BY bot_classification
      ORDER BY count DESC;
    `;

    const stats = await query(statsQuery);
    stats.rows.forEach(row => {
      console.log(`  ${row.bot_classification}: ${row.count}`);
    });

    await closeDB();

  } catch (err) {
    console.error('Reclassification failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run reclassification
reclassify();
