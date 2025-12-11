#!/usr/bin/env node
/**
 * ModelZero Analytics API Server
 * Serves dashboard data from PostgreSQL database
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB, query, closeDB } from './lib/db.js';
import fs from 'fs';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Load configuration
const CONFIG_PATH = path.join(__dirname, 'config/config.json');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('Configuration file not found:', CONFIG_PATH);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Initialize database
initDB(config.database);

// Middleware
app.use(cors());
app.use(express.json());

// HTML page routes (must be before static middleware)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/explore', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'explore.html'));
});

// Static files (after explicit routes)
app.use(express.static('public'));

// Serve recording tools from reddit-browser (full directory for JSON dependencies)
app.use('/recording', express.static(path.join(__dirname, '../reddit-browser/recording')));

// Helper function to parse time range
function getTimeFilter(range) {
  const filters = {
    '6h': "timestamp > NOW() - INTERVAL '6 hours'",
    '24h': "timestamp > NOW() - INTERVAL '24 hours'",
    '7d': "timestamp > NOW() - INTERVAL '7 days'",
    '30d': "timestamp > NOW() - INTERVAL '30 days'"
  };
  return filters[range] || filters['24h'];
}

// Helper function to get thaibelle memory care filter
function getThaibelleFilter(req) {
  if (req.query.thaibelleMemoryCareOnly === 'true') {
    return `AND (
      site != 'thaibelle.com' OR
      (site = 'thaibelle.com' AND (
        path ILIKE '%dementia%' OR
        path ILIKE '%memory%' OR
        path LIKE '/topics/dementia-care.html' OR
        path LIKE '/posts/thailand-dementia-memory-care.html' OR
        path LIKE '/data%dementia%' OR
        path LIKE '/data-output%dementia%'
      ))
    )`;
  }
  return '';
}

// API Endpoints

/**
 * GET /api/ip
 * Returns the client's IP address (used by VPN health checker)
 * Minimal endpoint - just returns the IP, nothing else
 */
app.get('/api/ip', (req, res) => {
  // Get client IP from various headers (Cloudflare, proxy, direct)
  const ip = req.headers['cf-connecting-ip'] ||  // Cloudflare
             req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||  // Proxy
             req.headers['x-real-ip'] ||
             req.socket?.remoteAddress ||
             req.ip;
  res.type('text/plain').send(ip);
});

/**
 * GET /api/stats
 * Returns overall statistics
 */
app.get('/api/stats', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const timeFilter = getTimeFilter(range);
    const thaibelleFilter = getThaibelleFilter(req);

    const statsQuery = `
      SELECT
        COUNT(*) as total_requests,
        COUNT(DISTINCT client_ip) as unique_ips,
        COUNT(*) FILTER (WHERE bot_classification = 'ai_official') as ai_official,
        COUNT(*) FILTER (WHERE bot_classification = 'ai_stealth') as ai_stealth,
        COUNT(*) FILTER (WHERE bot_classification = 'web_crawler') as web_crawler,
        COUNT(*) FILTER (WHERE bot_classification = 'monitoring_service') as monitoring_service,
        COUNT(*) FILTER (WHERE bot_classification = 'bot_undetermined') as bot_undetermined,
        COUNT(*) FILTER (WHERE bot_classification LIKE 'attack_%') as attack_traffic,
        COUNT(*) FILTER (WHERE bot_classification = 'human') as human
      FROM events
      WHERE ${timeFilter}
        AND client_ip NOT IN ('184.82.29.117', '123.25.101.101')
        ${thaibelleFilter};
    `;

    const result = await query(statsQuery);
    const stats = result.rows[0];

    res.json({
      totalRequests: parseInt(stats.total_requests),
      uniqueIps: parseInt(stats.unique_ips),
      aiOfficial: parseInt(stats.ai_official),
      aiStealth: parseInt(stats.ai_stealth),
      webCrawler: parseInt(stats.web_crawler),
      monitoringService: parseInt(stats.monitoring_service),
      botUndetermined: parseInt(stats.bot_undetermined),
      attackTraffic: parseInt(stats.attack_traffic),
      human: parseInt(stats.human)
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

/**
 * GET /api/timeline
 * Returns time-series data for multi-site overlay
 */
app.get('/api/timeline', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const timeFilter = getTimeFilter(range);
    const thaibelleFilter = getThaibelleFilter(req);

    // Determine time bucket based on range
    const buckets = {
      '6h': '5min',
      '24h': 'hour',
      '7d': '2hour',
      '30d': 'day'
    };
    const bucket = buckets[range] || 'hour';

    // Build the time_bucket expression based on bucket type
    let timeBucketExpr;
    if (bucket === '5min') {
      // 5-minute bucketing: floor timestamp to nearest 5 minutes
      timeBucketExpr = "to_timestamp(floor((extract('epoch' from timestamp) / 300)) * 300)";
    } else if (bucket === '2hour') {
      // 2-hour bucketing: floor timestamp to nearest 2 hours
      timeBucketExpr = "to_timestamp(floor((extract('epoch' from timestamp) / 7200)) * 7200)";
    } else {
      // Standard date_trunc for hour/day
      timeBucketExpr = `date_trunc('${bucket}', timestamp)`;
    }

    const timelineQuery = `
      SELECT
        ${timeBucketExpr} as time_bucket,
        REPLACE(site, 'www.', '') as site,
        COUNT(DISTINCT client_ip) as count
      FROM events
      WHERE ${timeFilter}
        AND site IN ('veteransmemorycare.org', 'memorycareguide.org', 'thaibelle.com',
                     'www.veteransmemorycare.org', 'www.memorycareguide.org', 'www.thaibelle.com')
        AND client_ip NOT IN ('184.82.29.117', '123.25.101.101')
        ${thaibelleFilter}
      GROUP BY time_bucket, REPLACE(site, 'www.', '')
      ORDER BY time_bucket ASC;
    `;

    const result = await query(timelineQuery);

    // Group by site
    const timeline = {};
    const sites = [
      'veteransmemorycare.org',
      'memorycareguide.org',
      'thaibelle.com'
    ];

    sites.forEach(site => {
      timeline[site] = [];
    });

    result.rows.forEach(row => {
      // Normalize site name (remove www.)
      let site = row.site.replace('www.', '');

      if (timeline[site]) {
        timeline[site].push({
          time: row.time_bucket,
          count: parseInt(row.count)
        });
      }
    });

    // Fill gaps with zeros for uniform spacing
    if (result.rows.length > 0) {
      const bucketIntervals = {
        '5min': 5 * 60 * 1000,          // 5 minutes in milliseconds
        'hour': 60 * 60 * 1000,          // 1 hour in milliseconds
        '2hour': 2 * 60 * 60 * 1000,     // 2 hours in milliseconds
        'day': 24 * 60 * 60 * 1000       // 1 day in milliseconds
      };

      const interval = bucketIntervals[bucket];

      // Find global min/max across ALL sites
      let globalMinTime = Infinity;
      let globalMaxTime = -Infinity;

      sites.forEach(site => {
        if (timeline[site].length > 0) {
          const times = timeline[site].map(d => new Date(d.time).getTime());
          globalMinTime = Math.min(globalMinTime, ...times);
          globalMaxTime = Math.max(globalMaxTime, ...times);
        }
      });

      // Round to bucket boundaries
      const startTime = Math.floor(globalMinTime / interval) * interval;
      const endTime = Math.ceil(globalMaxTime / interval) * interval;

      // Fill gaps for each site using the SAME global time range
      sites.forEach(site => {
        // Create a map of existing data points for this site
        const dataMap = new Map(
          timeline[site].map(d => {
            const t = new Date(d.time).getTime();
            const bucketTime = Math.floor(t / interval) * interval;
            return [bucketTime, d.count];
          })
        );

        // Generate all time buckets in the GLOBAL range
        const filledData = [];
        for (let t = startTime; t <= endTime; t += interval) {
          filledData.push({
            time: new Date(t).toISOString(),
            count: dataMap.get(t) || 0
          });
        }

        timeline[site] = filledData;
      });
    }

    res.json(timeline);
  } catch (error) {
    console.error('Error fetching timeline:', error);
    console.error('Error stack:', error.stack);
    console.error('Query was:', timelineQuery);
    res.status(500).json({ error: 'Failed to fetch timeline data', message: error.message });
  }
});

/**
 * GET /api/bot-classification
 * Returns bot classification breakdown
 */
app.get('/api/bot-classification', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const timeFilter = getTimeFilter(range);
    const thaibelleFilter = getThaibelleFilter(req);

    const classificationQuery = `
      SELECT
        CASE
          WHEN bot_classification = 'human' THEN 'Human'
          WHEN bot_classification = 'ai_official' THEN 'Official AI'
          WHEN bot_classification = 'ai_stealth' THEN 'Stealth AI'
          WHEN bot_classification = 'web_crawler' THEN 'Web Crawler'
          WHEN bot_classification = 'monitoring_service' THEN 'Monitoring'
          WHEN bot_classification = 'bot_undetermined' THEN 'Undetermined Bot'
          WHEN bot_classification LIKE 'attack_%' THEN 'Attack Traffic'
          ELSE 'Unknown'
        END as name,
        COUNT(*) as count
      FROM events
      WHERE ${timeFilter}
        AND client_ip NOT IN ('184.82.29.117', '123.25.101.101')
        ${thaibelleFilter}
      GROUP BY
        CASE
          WHEN bot_classification = 'human' THEN 'Human'
          WHEN bot_classification = 'ai_official' THEN 'Official AI'
          WHEN bot_classification = 'ai_stealth' THEN 'Stealth AI'
          WHEN bot_classification = 'web_crawler' THEN 'Web Crawler'
          WHEN bot_classification = 'monitoring_service' THEN 'Monitoring'
          WHEN bot_classification = 'bot_undetermined' THEN 'Undetermined Bot'
          WHEN bot_classification LIKE 'attack_%' THEN 'Attack Traffic'
          ELSE 'Unknown'
        END
      ORDER BY count DESC;
    `;

    const result = await query(classificationQuery);

    res.json(result.rows.map(row => ({
      name: row.name,
      count: parseInt(row.count)
    })));
  } catch (error) {
    console.error('Error fetching bot classification:', error);
    res.status(500).json({ error: 'Failed to fetch bot classification' });
  }
});

/**
 * GET /api/top-bots
 * Returns top bot names detected
 */
app.get('/api/top-bots', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const timeFilter = getTimeFilter(range);
    const thaibelleFilter = getThaibelleFilter(req);
    const limit = req.query.limit || 10;

    const topBotsQuery = `
      SELECT
        bot_name as name,
        COUNT(*) as count
      FROM events
      WHERE ${timeFilter}
        AND is_bot = true
        AND bot_name IS NOT NULL
        AND client_ip NOT IN ('184.82.29.117', '123.25.101.101')
        ${thaibelleFilter}
      GROUP BY bot_name
      ORDER BY count DESC
      LIMIT ${limit};
    `;

    const result = await query(topBotsQuery);

    res.json(result.rows.map(row => ({
      name: row.name,
      count: parseInt(row.count)
    })));
  } catch (error) {
    console.error('Error fetching top bots:', error);
    res.status(500).json({ error: 'Failed to fetch top bots' });
  }
});

/**
 * GET /api/geographic-heatmap
 * Returns lat/lng/count for geographic visualization
 */
app.get('/api/geographic-heatmap', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const timeFilter = getTimeFilter(range);
    const thaibelleFilter = getThaibelleFilter(req);

    const geoQuery = `
      SELECT
        ROUND(CAST(latitude AS numeric), 2) as lat,
        ROUND(CAST(longitude AS numeric), 2) as lng,
        COUNT(*) as count,
        country,
        city,
        COUNT(*) FILTER (WHERE bot_classification = 'human') as human_count,
        COUNT(*) FILTER (WHERE bot_classification = 'ai_official') as official_ai_count,
        COUNT(*) FILTER (WHERE bot_classification = 'ai_stealth') as stealth_ai_count,
        COUNT(*) FILTER (WHERE bot_classification = 'web_crawler') as web_crawler_count,
        COUNT(*) FILTER (WHERE bot_classification = 'monitoring_service') as monitoring_count,
        COUNT(*) FILTER (WHERE bot_classification LIKE 'attack_%') as attack_count
      FROM events
      WHERE ${timeFilter}
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND client_ip NOT IN ('184.82.29.117', '123.25.101.101')
        ${thaibelleFilter}
      GROUP BY ROUND(CAST(latitude AS numeric), 2),
               ROUND(CAST(longitude AS numeric), 2),
               country,
               city
      ORDER BY count DESC;
    `;

    const result = await query(geoQuery);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching geographic data:', error);
    res.status(500).json({ error: 'Failed to fetch geographic data' });
  }
});

/**
 * GET /api/dashboard
 * Returns all dashboard data in one request
 */
app.get('/api/dashboard', async (req, res) => {
  try {
    const range = req.query.range || '24h';

    const [stats, timeline, botClassification, topBots] = await Promise.all([
      fetch(`http://localhost:${PORT}/api/stats?range=${range}`).then(r => r.json()),
      fetch(`http://localhost:${PORT}/api/timeline?range=${range}`).then(r => r.json()),
      fetch(`http://localhost:${PORT}/api/bot-classification?range=${range}`).then(r => r.json()),
      fetch(`http://localhost:${PORT}/api/top-bots?range=${range}`).then(r => r.json())
    ]);

    res.json({
      stats,
      timeline,
      botClassification,
      topBots
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// ============================================================================
// Data Explorer API Endpoints
// ============================================================================

/**
 * POST /api/explore/interpret
 * Interprets natural language command and returns appropriate endpoint
 */
app.post('/api/explore/interpret', async (req, res) => {
  try {
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }

    // Available query types with descriptions
    const queryTypes = [
      {
        id: 'unique-ips',
        name: 'Unique IP Addresses',
        description: 'Lists all unique IP addresses with their total requests, bot classification, geographic location, and datacenter information. Sorted by request count.',
        keywords: ['unique ip', 'unique ips', 'all ips', 'ip list', 'ip addresses', 'show ips']
      },
      {
        id: 'subnet-clusters',
        name: 'IP Subnet Clusters',
        description: 'Groups traffic by IP subnet (/24 blocks) to identify clusters of activity from the same network. Shows total requests, unique IPs, bot classification, datacenter provider, and ASN information.',
        keywords: ['subnet', 'network', 'ip cluster', 'same ip range', 'ip block']
      },
      {
        id: 'time-bursts',
        name: 'Traffic Burst Activity',
        description: 'Identifies rapid sequential requests from the same IP within short time windows. Shows burst size, paths visited, and bot classification. Useful for detecting scanning or scraping behavior.',
        keywords: ['burst', 'rapid', 'spike', 'sequential', 'time cluster', 'fast requests']
      },
      {
        id: 'datacenter-ips',
        name: 'Datacenter Traffic',
        description: 'Shows traffic originating from cloud datacenters (AWS, Azure, GCP, etc). Useful for identifying AI bots and automated scrapers running on cloud infrastructure.',
        keywords: ['datacenter', 'cloud', 'aws', 'azure', 'gcp', 'hosting']
      },
      {
        id: 'residential-patterns',
        name: 'Residential Traffic',
        description: 'Shows traffic from residential ISPs (non-datacenter IPs). Typically indicates real users on home/mobile connections.',
        keywords: ['residential', 'home', 'isp', 'consumer', 'non-datacenter']
      },
      {
        id: 'asn-analysis',
        name: 'ASN Analysis',
        description: 'Groups traffic by Autonomous System Number (ASN/network provider). Shows which ISPs and hosting providers are sending traffic, with bot classification breakdown.',
        keywords: ['asn', 'autonomous system', 'network provider', 'isp']
      },
      {
        id: 'geographic-clusters',
        name: 'Geographic Clusters',
        description: 'Groups traffic by country and city. Shows geographic distribution of requests with average coordinates and bot classification.',
        keywords: ['geographic', 'location', 'country', 'city', 'region']
      }
    ];

    // Simple keyword matching (can be enhanced with more sophisticated NLP)
    const lowerCommand = command.toLowerCase();
    let bestMatch = null;
    let maxScore = 0;

    for (const queryType of queryTypes) {
      let score = 0;

      // Check for keyword matches
      for (const keyword of queryType.keywords) {
        if (lowerCommand.includes(keyword)) {
          score += 2;
        }
      }

      // Check for name match
      if (lowerCommand.includes(queryType.name.toLowerCase())) {
        score += 3;
      }

      if (score > maxScore) {
        maxScore = score;
        bestMatch = queryType;
      }
    }

    // If no clear match, provide suggestions
    if (maxScore === 0) {
      return res.json({
        success: false,
        suggestions: queryTypes.map(q => ({
          name: q.name,
          description: q.description
        }))
      });
    }

    res.json({
      success: true,
      queryType: bestMatch.id,
      queryName: bestMatch.name,
      endpoint: `/api/explore/${bestMatch.id}`
    });
  } catch (error) {
    console.error('Error interpreting command:', error);
    res.status(500).json({ error: 'Failed to interpret command' });
  }
});

/**
 * GET /api/explore/subnet-clusters
 * Returns IP subnet clustering analysis
 */
app.get('/api/explore/subnet-clusters', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const timeFilter = getTimeFilter(range);
    const minRequests = req.query.min || 10;

    const subnetQuery = `
      SELECT
        subnet,
        COUNT(*) as total_requests,
        COUNT(DISTINCT client_ip) as unique_ips,
        bot_classification,
        datacenter_provider,
        asn,
        asn_org,
        array_agg(DISTINCT country) FILTER (WHERE country IS NOT NULL) as countries
      FROM events
      WHERE ${timeFilter}
        AND subnet IS NOT NULL
        AND client_ip NOT IN ('184.82.29.117', '123.25.101.101')
      GROUP BY subnet, bot_classification, datacenter_provider, asn, asn_org
      HAVING COUNT(*) >= ${minRequests}
      ORDER BY total_requests DESC
      LIMIT 200;
    `;

    const result = await query(subnetQuery);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching subnet clusters:', error);
    res.status(500).json({ error: 'Failed to fetch subnet clusters' });
  }
});

/**
 * GET /api/explore/time-bursts
 * Returns burst activity (rapid sequential requests)
 */
app.get('/api/explore/time-bursts', async (req, res) => {
  try {
    const range = req.query.range || '6h';
    const timeFilter = getTimeFilter(range);
    const threshold = req.query.threshold || 20;

    const burstsQuery = `
      SELECT
        date_trunc('hour', timestamp) as time_bucket,
        client_ip,
        subnet,
        COUNT(*) as burst_size,
        bot_classification,
        datacenter_provider,
        array_agg(DISTINCT path ORDER BY path) FILTER (WHERE path IS NOT NULL) as paths_visited
      FROM events
      WHERE ${timeFilter}
        AND client_ip NOT IN ('184.82.29.117', '123.25.101.101')
      GROUP BY time_bucket, client_ip, subnet, bot_classification, datacenter_provider
      HAVING COUNT(*) >= ${threshold}
      ORDER BY burst_size DESC
      LIMIT 200;
    `;

    const result = await query(burstsQuery);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching time bursts:', error);
    res.status(500).json({ error: 'Failed to fetch time bursts' });
  }
});

/**
 * GET /api/explore/datacenter-ips
 * Returns all datacenter traffic
 */
app.get('/api/explore/datacenter-ips', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const timeFilter = getTimeFilter(range);

    const datacenterQuery = `
      SELECT
        client_ip,
        datacenter_provider,
        asn,
        asn_org,
        COUNT(*) as request_count,
        bot_classification,
        user_agent,
        array_agg(DISTINCT country) FILTER (WHERE country IS NOT NULL) as countries
      FROM events
      WHERE ${timeFilter}
        AND datacenter_provider IS NOT NULL
        AND client_ip NOT IN ('184.82.29.117', '123.25.101.101')
      GROUP BY client_ip, datacenter_provider, asn, asn_org, bot_classification, user_agent
      ORDER BY request_count DESC
      LIMIT 200;
    `;

    const result = await query(datacenterQuery);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching datacenter IPs:', error);
    res.status(500).json({ error: 'Failed to fetch datacenter IPs' });
  }
});

/**
 * GET /api/explore/residential-patterns
 * Returns residential IP traffic patterns
 */
app.get('/api/explore/residential-patterns', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const timeFilter = getTimeFilter(range);

    const residentialQuery = `
      SELECT
        subnet,
        country,
        COUNT(*) as request_count,
        COUNT(DISTINCT client_ip) as unique_ips,
        ROUND(AVG(CASE WHEN bot_classification = 'human' THEN 1.0 ELSE 0.0 END) * 100, 1) as human_percentage,
        bot_classification
      FROM events
      WHERE ${timeFilter}
        AND datacenter_provider IS NULL
        AND subnet IS NOT NULL
        AND client_ip NOT IN ('184.82.29.117', '123.25.101.101')
      GROUP BY subnet, country, bot_classification
      HAVING COUNT(*) >= 10
      ORDER BY request_count DESC
      LIMIT 200;
    `;

    const result = await query(residentialQuery);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching residential patterns:', error);
    res.status(500).json({ error: 'Failed to fetch residential patterns' });
  }
});

/**
 * GET /api/explore/asn-analysis
 * Returns ASN-level traffic analysis
 */
app.get('/api/explore/asn-analysis', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const timeFilter = getTimeFilter(range);

    const asnQuery = `
      SELECT
        asn,
        asn_org,
        datacenter_provider,
        COUNT(*) as total_requests,
        COUNT(DISTINCT client_ip) as unique_ips,
        COUNT(*) FILTER (WHERE bot_classification = 'human') as human_count,
        COUNT(*) FILTER (WHERE bot_classification = 'official_ai') as official_ai_count,
        COUNT(*) FILTER (WHERE bot_classification = 'stealth_ai') as stealth_ai_count,
        COUNT(*) FILTER (WHERE bot_classification = 'web_crawler') as web_crawler_count,
        array_agg(DISTINCT country) FILTER (WHERE country IS NOT NULL) as countries
      FROM events
      WHERE ${timeFilter}
        AND asn IS NOT NULL
        AND client_ip NOT IN ('184.82.29.117', '123.25.101.101')
      GROUP BY asn, asn_org, datacenter_provider
      ORDER BY total_requests DESC
      LIMIT 100;
    `;

    const result = await query(asnQuery);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching ASN analysis:', error);
    res.status(500).json({ error: 'Failed to fetch ASN analysis' });
  }
});

/**
 * GET /api/explore/unique-ips
 * Returns all unique IP addresses with their request counts and classifications
 */
app.get('/api/explore/unique-ips', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const timeFilter = getTimeFilter(range);

    const uniqueIPsQuery = `
      SELECT
        client_ip,
        subnet,
        COUNT(*) as total_requests,
        bot_classification,
        country,
        city,
        datacenter_provider,
        asn_org,
        MIN(timestamp) as first_seen,
        MAX(timestamp) as last_seen
      FROM events
      WHERE ${timeFilter}
        AND client_ip NOT IN ('184.82.29.117', '123.25.101.101')
      GROUP BY client_ip, subnet, bot_classification, country, city, datacenter_provider, asn_org
      ORDER BY total_requests DESC
      LIMIT 500;
    `;

    const result = await query(uniqueIPsQuery);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching unique IPs:', error);
    res.status(500).json({ error: 'Failed to fetch unique IPs' });
  }
});

/**
 * GET /api/explore/geographic-clusters
 * Returns geographic clustering data
 */
app.get('/api/explore/geographic-clusters', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const timeFilter = getTimeFilter(range);

    const geoQuery = `
      SELECT
        country,
        city,
        ROUND(CAST(AVG(latitude) AS numeric), 2) as avg_lat,
        ROUND(CAST(AVG(longitude) AS numeric), 2) as avg_lng,
        COUNT(*) as total_requests,
        COUNT(DISTINCT client_ip) as unique_ips,
        COUNT(*) FILTER (WHERE datacenter_provider IS NOT NULL) as datacenter_count,
        COUNT(*) FILTER (WHERE bot_classification = 'human') as human_count,
        COUNT(*) FILTER (WHERE bot_classification = 'stealth_ai') as stealth_ai_count
      FROM events
      WHERE ${timeFilter}
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND client_ip NOT IN ('184.82.29.117', '123.25.101.101')
      GROUP BY country, city
      HAVING COUNT(*) >= 10
      ORDER BY total_requests DESC
      LIMIT 150;
    `;

    const result = await query(geoQuery);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching geographic clusters:', error);
    res.status(500).json({ error: 'Failed to fetch geographic clusters' });
  }
});

// Proxy search intelligence API endpoints
app.use('/api/search', (req, res) => {
  const endpoint = req.path.replace('/api/search', '');
  const queryString = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';

  const options = {
    hostname: 'localhost',
    port: 3002,
    path: `/api${endpoint}${queryString}`,
    method: 'GET'
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Preserve the original Content-Type from the proxied response
    const contentType = proxyRes.headers['content-type'] || 'application/json';
    res.setHeader('Content-Type', contentType);
    res.status(proxyRes.statusCode);

    // Pipe the response directly to preserve binary data (for images)
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (error) => {
    console.error('Error proxying search intelligence request:', error);
    res.status(500).json({ error: 'Failed to fetch search intelligence data' });
  });

  proxyReq.end();
});

// Start server
app.listen(PORT, () => {
  console.log(`ModelZero Analytics API running on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`Search Intelligence: http://localhost:${PORT}/search-intelligence`);
  console.log(`Data Explorer: http://localhost:${PORT}/explore`);
  console.log(`API endpoints:`);
  console.log(`  - GET /api/stats?range=24h`);
  console.log(`  - GET /api/timeline?range=24h`);
  console.log(`  - GET /api/bot-classification?range=24h`);
  console.log(`  - GET /api/top-bots?range=24h`);
  console.log(`  - GET /api/dashboard?range=24h`);
  console.log(`  - GET /api/search/* (proxied to search intelligence)`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down server...');
  await closeDB();
  process.exit(0);
});
