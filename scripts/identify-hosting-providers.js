#!/usr/bin/env node
/**
 * Identify Hosting Providers Currently Marked as "Residential"
 * Find all ASN organizations that are actually hosting/cloud providers
 */

import { initDB, query, closeDB } from '../lib/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

async function identifyHostingProviders() {
  console.log('='.repeat(80));
  console.log('HOSTING PROVIDERS CURRENTLY MARKED AS "RESIDENTIAL"');
  console.log('='.repeat(80));

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    initDB(config.database);

    // Patterns that indicate hosting/datacenter
    const hostingPatterns = [
      'cloud', 'hosting', 'server', 'datacenter', 'data center',
      'vps', 'virtual', 'compute', 'infrastructure',
      'colocation', 'colo', 'network services', 'internet services'
    ];

    // Get all ASN orgs currently marked as residential
    const allOrgs = await query(`
      SELECT DISTINCT
        asn,
        asn_org,
        datacenter_provider,
        COUNT(*) as request_count,
        COUNT(DISTINCT client_ip) as unique_ips,
        array_agg(DISTINCT country) as countries
      FROM events
      WHERE datacenter_provider IS NULL
        AND asn_org IS NOT NULL
      GROUP BY asn, asn_org, datacenter_provider
      ORDER BY request_count DESC;
    `);

    // Categorize organizations
    const categories = {
      major_cloud: [],
      hosting_vps: [],
      cdn_proxy: [],
      telecom_cloud: [],
      suspicious: []
    };

    allOrgs.rows.forEach(row => {
      const org = row.asn_org.toLowerCase();

      // Major cloud providers
      if (org.includes('tencent') || org.includes('alibaba') ||
          org.includes('baidu') || org.includes('huawei')) {
        categories.major_cloud.push(row);
      }
      // CDN/Proxy networks
      else if (org.includes('cloudflare') || org.includes('akamai') ||
               org.includes('fastly') || org.includes('cdn')) {
        categories.cdn_proxy.push(row);
      }
      // Telecom cloud services
      else if ((org.includes('china') || org.includes('telecom') ||
                org.includes('unicom') || org.includes('mobile')) &&
               (org.includes('cloud') || org.includes('idc'))) {
        categories.telecom_cloud.push(row);
      }
      // Hosting/VPS providers (has hosting-related keywords)
      else if (hostingPatterns.some(pattern => org.includes(pattern))) {
        categories.hosting_vps.push(row);
      }
      // High volume without obvious classification
      else if (row.request_count > 50 && row.unique_ips > 10) {
        categories.suspicious.push(row);
      }
    });

    // Print categorized results
    console.log('\n🏢 MAJOR CLOUD PROVIDERS (Should be tracked)\n');
    categories.major_cloud.forEach(row => {
      console.log(`  ASN ${String(row.asn).padStart(6)} - ${row.asn_org.substring(0, 70)}`);
      console.log(`  ${' '.repeat(13)} ${row.request_count} requests, ${row.unique_ips} IPs, Countries: ${row.countries.slice(0,3).join(', ')}`);
    });

    console.log('\n\n📡 CDN/PROXY NETWORKS (Should be tracked)\n');
    categories.cdn_proxy.forEach(row => {
      console.log(`  ASN ${String(row.asn).padStart(6)} - ${row.asn_org.substring(0, 70)}`);
      console.log(`  ${' '.repeat(13)} ${row.request_count} requests, ${row.unique_ips} IPs, Countries: ${row.countries.slice(0,3).join(', ')}`);
    });

    console.log('\n\n☁️  TELECOM CLOUD SERVICES (Should be tracked)\n');
    categories.telecom_cloud.forEach(row => {
      console.log(`  ASN ${String(row.asn).padStart(6)} - ${row.asn_org.substring(0, 70)}`);
      console.log(`  ${' '.repeat(13)} ${row.request_count} requests, ${row.unique_ips} IPs, Countries: ${row.countries.slice(0,3).join(', ')}`);
    });

    console.log('\n\n🖥️  HOSTING/VPS PROVIDERS (Should be tracked)\n');
    categories.hosting_vps.slice(0, 30).forEach(row => {
      console.log(`  ASN ${String(row.asn).padStart(6)} - ${row.asn_org.substring(0, 70)}`);
      console.log(`  ${' '.repeat(13)} ${row.request_count} requests, ${row.unique_ips} IPs`);
    });
    if (categories.hosting_vps.length > 30) {
      console.log(`\n  ... and ${categories.hosting_vps.length - 30} more hosting providers`);
    }

    console.log('\n\n🚩 SUSPICIOUS HIGH-VOLUME (Unknown type)\n');
    categories.suspicious.slice(0, 20).forEach(row => {
      console.log(`  ASN ${String(row.asn).padStart(6)} - ${row.asn_org.substring(0, 70)}`);
      console.log(`  ${' '.repeat(13)} ${row.request_count} requests, ${row.unique_ips} IPs, Countries: ${row.countries.slice(0,3).join(', ')}`);
    });

    // Generate ASN mapping for code
    console.log('\n\n' + '='.repeat(80));
    console.log('RECOMMENDED ASN ADDITIONS FOR asn-lookup.js');
    console.log('='.repeat(80));
    console.log('\n// Major Cloud Providers');
    categories.major_cloud.forEach(row => {
      const provider = row.asn_org.toLowerCase().includes('tencent') ? 'tencent' :
                      row.asn_org.toLowerCase().includes('alibaba') ? 'alibaba' :
                      row.asn_org.toLowerCase().includes('baidu') ? 'baidu' :
                      row.asn_org.toLowerCase().includes('huawei') ? 'huawei' : 'unknown';
      console.log(`  ${row.asn}: '${provider}', // ${row.asn_org.substring(0, 60)}`);
    });

    console.log('\n// CDN/Proxy Networks');
    categories.cdn_proxy.forEach(row => {
      const provider = row.asn_org.toLowerCase().includes('cloudflare') ? 'cloudflare' :
                      row.asn_org.toLowerCase().includes('akamai') ? 'akamai' :
                      row.asn_org.toLowerCase().includes('fastly') ? 'fastly' : 'cdn';
      console.log(`  ${row.asn}: '${provider}', // ${row.asn_org.substring(0, 60)}`);
    });

    console.log('\n// Telecom Cloud Services');
    categories.telecom_cloud.forEach(row => {
      console.log(`  ${row.asn}: 'telecom-cloud', // ${row.asn_org.substring(0, 60)}`);
    });

    // Statistics
    const totalHosting = categories.major_cloud.length +
                        categories.cdn_proxy.length +
                        categories.telecom_cloud.length +
                        categories.hosting_vps.length;

    const totalRequests = [...categories.major_cloud, ...categories.cdn_proxy,
                          ...categories.telecom_cloud, ...categories.hosting_vps]
                          .reduce((sum, row) => sum + parseInt(row.request_count), 0);

    console.log('\n\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`\nFound ${totalHosting} hosting/cloud providers currently marked as "residential"`);
    console.log(`These account for ${totalRequests.toLocaleString()} requests in your database`);
    console.log(`\nBreakdown:`);
    console.log(`  Major Cloud Providers: ${categories.major_cloud.length}`);
    console.log(`  CDN/Proxy Networks: ${categories.cdn_proxy.length}`);
    console.log(`  Telecom Cloud Services: ${categories.telecom_cloud.length}`);
    console.log(`  Other Hosting/VPS: ${categories.hosting_vps.length}`);
    console.log(`  Suspicious High-Volume: ${categories.suspicious.length}`);

    await closeDB();

  } catch (err) {
    console.error('\n❌ Analysis failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

identifyHostingProviders();
