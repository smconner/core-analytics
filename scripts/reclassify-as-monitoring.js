#!/usr/bin/env node
/**
 * Reclassify Undetermined Bots as Monitoring Services
 * Based on behavioral analysis: Azure/datacenter + no UA + root paths only
 */

import { initDB, query, closeDB } from '../lib/db.js';
import { classify } from '../lib/ai-classifier-v2.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

async function reclassifyMonitoring() {
  console.log('='.repeat(80));
  console.log('RECLASSIFYING UNDETERMINED BOTS AS MONITORING SERVICES');
  console.log('='.repeat(80));

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    initDB(config.database);

    // Find undetermined bots that match monitoring patterns
    console.log('\nFinding undetermined bots that match monitoring patterns...\n');

    const candidates = await query(`
      SELECT DISTINCT
        client_ip,
        user_agent,
        path,
        datacenter_provider,
        has_sec_fetch_headers,
        has_client_hints,
        COUNT(*) as request_count,
        array_agg(DISTINCT path) as paths,
        array_agg(id) as event_ids
      FROM events
      WHERE bot_classification = 'bot_undetermined'
        AND client_ip != '184.82.29.117'
      GROUP BY client_ip, user_agent, path, datacenter_provider, has_sec_fetch_headers, has_client_hints
      HAVING COUNT(*) > 0
      ORDER BY COUNT(*) DESC
      LIMIT 500;
    `);

    console.log(`Found ${candidates.rows.length} candidate patterns to check\n`);

    let reclassified = 0;
    let checked = 0;

    for (const candidate of candidates.rows) {
      checked++;

      // Build headers for classifier
      const headers = {};
      if (candidate.has_sec_fetch_headers) {
        headers['Sec-Fetch-Site'] = 'none';
      }
      if (candidate.has_client_hints) {
        headers['Sec-Ch-Ua'] = '"Chrome";v="120"';
      }

      // Re-classify using updated classifier
      const result = await classify({
        client_ip: candidate.client_ip,
        user_agent: candidate.user_agent,
        path: candidate.path,
        headers: headers,
        datacenter_provider: candidate.datacenter_provider
      });

      // If now classified as monitoring, update all matching events
      if (result.bot_classification === 'monitoring_service') {
        // Update all events from this pattern
        const updateResult = await query(`
          UPDATE events
          SET bot_classification = 'monitoring_service'
          WHERE id = ANY($1::int[]);
        `, [candidate.event_ids]);

        reclassified += updateResult.rowCount;

        if (reclassified <= 10) {
          console.log(`✓ ${candidate.client_ip} (${candidate.datacenter_provider || 'residential'})`);
          console.log(`  ${updateResult.rowCount} events → monitoring_service`);
          console.log(`  Reason: ${result.detection_reason}`);
          console.log(`  Paths: ${candidate.paths.slice(0, 3).join(', ')}${candidate.paths.length > 3 ? '...' : ''}`);
          console.log('');
        }
      }

      if (checked % 100 === 0) {
        console.log(`Processed ${checked}/${candidates.rows.length} patterns...`);
      }
    }

    if (reclassified > 10) {
      console.log(`... and ${reclassified - 10} more events reclassified\n`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('RECLASSIFICATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`\nCandidate patterns checked: ${checked}`);
    console.log(`Events reclassified: ${reclassified}`);

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

reclassifyMonitoring();
