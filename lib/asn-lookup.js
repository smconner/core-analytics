/**
 * ASN Lookup Module
 * Identify Autonomous System Number and datacenter providers
 */

import { Reader } from '@maxmind/geoip2-node';
import fs from 'fs';

let asnReader;

// Mapping of ASN to datacenter providers
const DATACENTER_ASN = {
  // Microsoft Azure
  8075: 'azure',

  // Google Cloud Platform
  15169: 'gcp',
  396982: 'gcp',

  // Amazon Web Services
  16509: 'aws',
  14618: 'aws',

  // Cloudflare
  13335: 'cloudflare',
  132892: 'cloudflare',  // Cloudflare, Inc. (additional ASN)

  // OVH
  16276: 'ovh',

  // DigitalOcean
  14061: 'digitalocean',

  // Vultr
  20473: 'vultr',

  // Linode
  63949: 'linode',

  // Hetzner
  24940: 'hetzner',

  // Tencent Cloud
  132203: 'tencent',
  45090: 'tencent',

  // Alibaba Cloud
  45102: 'alibaba',
  37963: 'alibaba',

  // Huawei Cloud
  136907: 'huawei',

  // Baidu Cloud
  55967: 'baidu',

  // Telecom IDC/Cloud Services
  134756: 'telecom-cloud',  // CHINANET Nanjing IDC
  59223: 'telecom-cloud',   // CHINANET Qinghai IDC
  134768: 'telecom-cloud',  // CHINANET SHAANXI Cloud
  23724: 'telecom-cloud',   // China Telecommunications IDC
  137693: 'telecom-cloud',  // CHINATELECOM Guangxi IDC

  // Other Major Hosting Providers
  58519: 'hosting',         // Cloud Computing Corporation
  199785: 'hosting',        // Cloud Hosting Solutions
  204916: 'hosting',        // LLC Vpsville
  36352: 'hosting',         // AS-COLOCROSSING
  18779: 'hosting',         // EGIHOSTING
  23576: 'hosting',         // NAVER Cloud Corp
  48282: 'hosting',         // Hosting technology LTD
  51396: 'hosting',         // Pfcloud UG
  55286: 'hosting',         // SERVER-MANIA
  142002: 'hosting',        // Scloud Pte Ltd
  198584: 'hosting',        // PIO-Hosting GmbH
  216071: 'hosting',        // Servers Tech Fzco
  394474: 'hosting',        // WHITELABELCOLO

  // Detected from browser automation analysis (2025-11)
  9009: 'hosting',          // M247 Europe SRL (21 requests)
  46261: 'hosting',         // QUICKPACKET (16 requests)
  212512: 'hosting',        // Detai Prosperous Technologies Limited (14 requests)
  11878: 'hosting',         // TZULO (7 requests)
  49505: 'hosting',         // JSC Selectel (7 requests)
  50340: 'hosting',         // JSC Selectel (additional ASN, 3 requests)
  26548: 'hosting',         // PUREVOLTAGE-INC (3 requests)
  64267: 'hosting'          // AS-SPRIO (1 requests)
};

// Patterns in org names that indicate datacenter/hosting
const DATACENTER_PATTERNS = [
  /\bcloud\b/i,
  /\bhosting\b/i,
  /\bserver\b/i,
  /\bdatacenter\b/i,
  /\bdata center\b/i,
  /\bvps\b/i,
  /\bvirtual private server\b/i,
  /\bcompute\b/i,
  /\binfrastructure\b/i,
  /\bcolocation\b/i,
  /\bcolo\b/i,
  /\bidc\b/i,  // Internet Data Center
  /\bcdn\b/i   // Content Delivery Network
];

/**
 * Initialize ASN reader with MaxMind database
 * @param {string} dbPath - Path to GeoLite2-ASN.mmdb
 */
export async function initASN(dbPath = '/usr/share/GeoIP/GeoLite2-ASN.mmdb') {
  // Check if database file exists
  if (!fs.existsSync(dbPath)) {
    console.warn(`ASN database not found at ${dbPath}`);
    console.warn('ASN lookups will return null values');
    console.warn('Download from: https://dev.maxmind.com/geoip/geolite2-free-geolocation-data');
    return false;
  }

  try {
    asnReader = await Reader.open(dbPath);
    console.log(`ASN database loaded: ${dbPath}`);
    return true;
  } catch (err) {
    console.error('Failed to load ASN database:', err.message);
    return false;
  }
}

/**
 * Lookup ASN for an IP address
 * @param {string} ip - IP address (IPv4 or IPv6)
 * @returns {Object} ASN data
 * @returns {number|null} return.asn - Autonomous System Number
 * @returns {string|null} return.asn_org - ASN organization name
 * @returns {string|null} return.datacenter_provider - Datacenter provider (azure, gcp, aws, etc.)
 */
export function lookupASN(ip) {
  if (!asnReader) {
    return {
      asn: null,
      asn_org: null,
      datacenter_provider: null
    };
  }

  try {
    const response = asnReader.asn(ip);
    const asn = response.autonomousSystemNumber;
    const org = response.autonomousSystemOrganization;

    // First check explicit ASN mapping
    let provider = DATACENTER_ASN[asn] || null;

    // If not found in explicit list, check org name patterns
    if (!provider && org) {
      if (DATACENTER_PATTERNS.some(pattern => pattern.test(org))) {
        provider = 'hosting';  // Generic hosting/datacenter
      }
    }

    return {
      asn,
      asn_org: org,
      datacenter_provider: provider
    };
  } catch (err) {
    // IP not found in database (private IP, invalid, etc.)
    return {
      asn: null,
      asn_org: null,
      datacenter_provider: null
    };
  }
}

/**
 * Check if IP is from a known datacenter
 * @param {number} asn - Autonomous System Number
 * @returns {boolean} True if from datacenter
 */
export function isDatacenterASN(asn) {
  return asn in DATACENTER_ASN;
}

/**
 * Get datacenter provider from ASN
 * @param {number} asn - Autonomous System Number
 * @returns {string|null} Provider name or null
 */
export function getDatacenterProvider(asn) {
  return DATACENTER_ASN[asn] || null;
}

/**
 * Add custom ASN mapping
 * @param {number} asn - ASN number
 * @param {string} provider - Provider name
 */
export function addDatacenterASN(asn, provider) {
  DATACENTER_ASN[asn] = provider;
}

/**
 * Test ASN lookup with known IPs
 */
export function testASN() {
  console.log('\n=== Testing ASN Lookups ===');

  const testIPs = [
    '20.39.203.102',    // Azure
    '34.1.1.1',         // Google Cloud
    '3.5.1.1',          // AWS
    '74.7.227.134',     // Azure (GPTBot)
    '104.210.140.135'   // Azure (OAI-SearchBot)
  ];

  testIPs.forEach(ip => {
    const result = lookupASN(ip);
    console.log(`${ip}:`, result);
  });

  console.log('=========================\n');
}

/**
 * Close ASN reader
 */
export function closeASN() {
  if (asnReader) {
    asnReader = null;
    console.log('ASN reader closed');
  }
}
