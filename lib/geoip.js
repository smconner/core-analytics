/**
 * GeoIP Module
 * MaxMind GeoLite2 city-level geolocation
 */

import { Reader } from '@maxmind/geoip2-node';
import fs from 'fs';

let cityReader;

/**
 * Initialize GeoIP reader with MaxMind database
 * @param {string} dbPath - Path to GeoLite2-City.mmdb
 */
export async function initGeoIP(dbPath = '/usr/share/GeoIP/GeoLite2-City.mmdb') {
  // Check if database file exists
  if (!fs.existsSync(dbPath)) {
    console.warn(`GeoIP database not found at ${dbPath}`);
    console.warn('GeoIP lookups will return null values');
    console.warn('Download from: https://dev.maxmind.com/geoip/geolite2-free-geolocation-data');
    return false;
  }

  try {
    cityReader = await Reader.open(dbPath);
    console.log(`GeoIP database loaded: ${dbPath}`);
    return true;
  } catch (err) {
    console.error('Failed to load GeoIP database:', err.message);
    return false;
  }
}

/**
 * Lookup city-level geolocation for an IP address
 * @param {string} ip - IP address (IPv4 or IPv6)
 * @returns {Object} Geolocation data
 * @returns {string|null} return.country - Country ISO code
 * @returns {string|null} return.city - City name (English)
 * @returns {number|null} return.latitude - Latitude
 * @returns {number|null} return.longitude - Longitude
 */
export function lookupCity(ip) {
  if (!cityReader) {
    return {
      country: null,
      city: null,
      latitude: null,
      longitude: null
    };
  }

  try {
    const response = cityReader.city(ip);
    return {
      country: response.country?.isoCode || null,
      city: response.city?.names?.en || null,
      latitude: response.location?.latitude || null,
      longitude: response.location?.longitude || null
    };
  } catch (err) {
    // IP not found in database (private IP, invalid, etc.)
    // This is normal, so we don't log it as an error
    return {
      country: null,
      city: null,
      latitude: null,
      longitude: null
    };
  }
}

/**
 * Test GeoIP lookup with known IPs
 */
export function testGeoIP() {
  console.log('\n=== Testing GeoIP Lookups ===');

  const testIPs = [
    '8.8.8.8',          // Google DNS (Mountain View, US)
    '74.7.227.134',     // Azure (Ashburn, US)
    '1.1.1.1',          // Cloudflare (Los Angeles, US)
    '2405:9800:b911:2816::1' // IPv6 Thailand
  ];

  testIPs.forEach(ip => {
    const result = lookupCity(ip);
    console.log(`${ip}:`, result);
  });

  console.log('=========================\n');
}

/**
 * Close GeoIP reader
 */
export function closeGeoIP() {
  if (cityReader) {
    // MaxMind reader doesn't need explicit closing
    cityReader = null;
    console.log('GeoIP reader closed');
  }
}
