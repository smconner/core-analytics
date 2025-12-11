/**
 * AI Bot Classifier Module
 * 3-level bot detection: User-Agent, Datacenter IP, Behavioral
 */

import { lookupASN, isDatacenterASN } from './asn-lookup.js';

// ============================================================================
// Level 1: User-Agent Pattern Matching
// ============================================================================

// Official AI Bots
const AI_BOTS = {
  // OpenAI
  'GPTBot': /GPTBot/i,
  'OAI-SearchBot': /OAI-SearchBot/i,
  'ChatGPT-User': /ChatGPT-User/i,

  // Anthropic
  'ClaudeBot': /ClaudeBot/i,
  'Claude-Web': /Claude-Web/i,

  // Google
  'Google-Extended': /Google-Extended/i,
  'Gemini-Deep-Research': /Gemini-Deep-Research/i,
  'GoogleAgent-Mariner': /GoogleAgent-Mariner/i,

  // Perplexity
  'PerplexityBot': /PerplexityBot/i,
  'Perplexity-User': /Perplexity-User/i,

  // Meta
  'Meta-ExternalAgent': /Meta-ExternalAgent/i,
  'Meta-ExternalFetcher': /Meta-ExternalFetcher/i,

  // Others
  'Amazonbot': /Amazonbot/i,
  'MistralAI-User': /MistralAI-User/i,
  'Applebot-Extended': /Applebot-Extended/i,
  'Bytespider': /Bytespider/i,
  'YouBot': /YouBot/i
};

// Traditional Web Crawlers
const WEB_CRAWLERS = {
  'Googlebot': /Googlebot/i,
  'Bingbot': /bingbot/i,
  'Yahoo': /Yahoo.*Slurp/i,
  'DuckDuckBot': /DuckDuckBot/i,
  'Baiduspider': /Baiduspider/i,
  'YandexBot': /YandexBot/i,
  'Sogou': /Sogou/i,
  'Exabot': /Exabot/i,
  'facebookexternalhit': /facebookexternalhit/i,
  'Twitterbot': /Twitterbot/i,
  'LinkedInBot': /LinkedInBot/i,
  'Slackbot': /Slackbot/i,
  'Discordbot': /Discordbot/i,
  'WhatsApp': /WhatsApp/i,
  'TelegramBot': /TelegramBot/i
};

/**
 * Classify bot by User-Agent string (Level 1)
 * @param {string} userAgent - User-Agent header
 * @returns {Object|null} Classification or null if not detected
 */
function classifyUserAgent(userAgent) {
  if (!userAgent) return null;

  // Check AI bots first (higher priority)
  for (const [name, pattern] of Object.entries(AI_BOTS)) {
    if (pattern.test(userAgent)) {
      return {
        is_bot: true,
        bot_classification: 'official_ai',
        bot_name: name,
        detection_level: 1
      };
    }
  }

  // Check web crawlers
  for (const [name, pattern] of Object.entries(WEB_CRAWLERS)) {
    if (pattern.test(userAgent)) {
      return {
        is_bot: true,
        bot_classification: 'web_crawler',
        bot_name: name,
        detection_level: 1
      };
    }
  }

  // Check generic bot patterns
  if (/bot|crawler|spider|scraper|curl|wget|python|java|http/i.test(userAgent)) {
    return {
      is_bot: true,
      bot_classification: 'web_crawler',
      bot_name: 'Generic-Bot',
      detection_level: 1
    };
  }

  return null; // Not detected at Level 1
}

// ============================================================================
// Level 2: Datacenter IP Detection
// ============================================================================

/**
 * Check if User-Agent looks like a browser
 * @param {string} userAgent - User-Agent string
 * @returns {boolean} True if browser-like
 */
function isBrowserUA(userAgent) {
  if (!userAgent) return false;

  // Must contain Mozilla and one of the major browsers
  const hasMozilla = /Mozilla/i.test(userAgent);
  const hasBrowser = /Chrome|Safari|Firefox|Edge/i.test(userAgent);

  // Must NOT contain bot keywords
  const hasBot = /bot|crawler|spider|scraper/i.test(userAgent);

  return hasMozilla && hasBrowser && !hasBot;
}

/**
 * Check if request has official bot headers
 * @param {Object} headers - Request headers object
 * @returns {boolean} True if has bot-specific headers
 */
function hasOfficialBotHeaders(headers) {
  return !!(
    headers['From'] ||
    headers['X-Openai-Host-Hash'] ||
    headers['X-Request-Id'] ||
    /bot|crawler/i.test(headers['User-Agent'])
  );
}

/**
 * Classify stealth crawler by datacenter IP (Level 2)
 * @param {string} ip - IP address
 * @param {string} userAgent - User-Agent string
 * @param {Object} headers - Request headers
 * @returns {Object|null} Classification or null if not stealth
 */
async function classifyDatacenter(ip, userAgent, headers) {
  // Lookup ASN
  const asnData = lookupASN(ip);

  // If from datacenter + browser UA + no official bot headers = stealth
  if (asnData.datacenter_provider &&
      isBrowserUA(userAgent) &&
      !hasOfficialBotHeaders(headers)) {

    return {
      is_bot: true,
      bot_classification: 'stealth_ai',
      bot_name: `${asnData.datacenter_provider.toUpperCase()}-Stealth`,
      detection_level: 2
    };
  }

  return null; // Not stealth
}

// ============================================================================
// Level 3: Behavioral Analysis - AI Training Agent Detection
// ============================================================================

/**
 * Detect AI training agents based on behavioral patterns
 * Training agents have distinctive characteristics:
 * - Run from cloud datacenters (Azure, GCP, AWS)
 * - High request rates (>0.5 req/sec sustained)
 * - Short session duration (<2 minutes)
 * - Browser-like User-Agent (spoofed)
 * - Missing human browser signals (Sec-Fetch headers)
 *
 * @param {Object} event - Current event data
 * @param {Object} sessionStats - Session statistics (if available)
 * @returns {Object|null} Classification or null
 */
function detectTrainingAgent(event, sessionStats = null) {
  const { datacenter_provider, user_agent, headers } = event;

  // Must be from datacenter
  if (!datacenter_provider) return null;

  // Must have browser-like UA (they spoof legitimate browsers)
  if (!isBrowserUA(user_agent)) return null;

  // Check for missing human browser signals
  const browserSignals = detectBrowserSignals(headers);
  const missingHumanSignals = !browserSignals.has_sec_fetch_headers;

  // If we have session stats, check for burst behavior
  if (sessionStats) {
    const { request_count, duration_seconds } = sessionStats;

    // High request rate: >0.5 req/sec
    const requestRate = duration_seconds > 0 ? request_count / duration_seconds : 0;

    // Training agent pattern:
    // 1. From datacenter
    // 2. Browser-like UA
    // 3. High request rate (>0.5/sec) OR short burst (<2 min + >20 requests)
    // 4. Missing human browser signals
    if (requestRate > 0.5 || (duration_seconds < 120 && request_count > 20)) {
      if (missingHumanSignals) {
        return {
          is_bot: true,
          bot_classification: 'ai_training',
          bot_name: `${datacenter_provider.toUpperCase()}-Training-Agent`,
          detection_level: 3,
          detection_reason: `Burst pattern: ${request_count} req in ${duration_seconds}s (${requestRate.toFixed(2)}/sec)`
        };
      }
    }
  }

  // Fallback: If from datacenter with browser UA but missing signals, likely stealth
  if (missingHumanSignals) {
    return {
      is_bot: true,
      bot_classification: 'ai_training',
      bot_name: `${datacenter_provider.toUpperCase()}-Training-Agent`,
      detection_level: 3,
      detection_reason: 'Datacenter IP + browser UA + missing Sec-Fetch headers'
    };
  }

  return null;
}

/**
 * Analyze behavioral patterns (formerly placeholder)
 * @param {Object} event - Event data
 * @param {Array} recentEvents - Recent events from same IP
 * @returns {Object|null} Classification or null
 */
function analyzeBehavior(event, recentEvents = []) {
  // Calculate session statistics if we have recent events
  let sessionStats = null;
  if (recentEvents && recentEvents.length > 0) {
    const timestamps = recentEvents.map(e => new Date(e.timestamp).getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const duration_seconds = (maxTime - minTime) / 1000;

    sessionStats = {
      request_count: recentEvents.length,
      duration_seconds: duration_seconds
    };
  }

  // Check for AI training agent patterns
  const trainingAgent = detectTrainingAgent(event, sessionStats);
  if (trainingAgent) return trainingAgent;

  // Future: Add other behavioral patterns
  // - Data harvesting (downloading JSON/CSV files)
  // - Sequential path scanning

  return null;
}

// ============================================================================
// Main Classification Function
// ============================================================================

/**
 * Classify a request as bot/human with 3-level detection
 * @param {Object} event - Event data
 * @param {string} event.client_ip - Client IP address
 * @param {string} event.user_agent - User-Agent header
 * @param {Object} event.headers - Request headers
 * @param {number} event.asn - ASN number (if already looked up)
 * @param {string} event.datacenter_provider - Provider (if already looked up)
 * @param {Array} event.recentEvents - Recent events from same IP (optional, for behavioral)
 * @returns {Promise<Object>} Classification result
 */
export async function classify(event) {
  // Level 1: User-Agent
  let classification = classifyUserAgent(event.user_agent);
  if (classification) return classification;

  // Level 2: Datacenter IP
  classification = await classifyDatacenter(
    event.client_ip,
    event.user_agent,
    event.headers || {}
  );
  if (classification) return classification;

  // Level 3: Behavioral Analysis (AI Training Agent Detection)
  classification = analyzeBehavior(event, event.recentEvents);
  if (classification) return classification;

  // Default: Human
  return {
    is_bot: false,
    bot_classification: 'human',
    bot_name: null,
    detection_level: null
  };
}

// ============================================================================
// Human Browser Signal Detection
// ============================================================================

/**
 * Detect human browser signals
 * @param {Object} headers - Request headers
 * @returns {Object} Browser signals
 */
export function detectBrowserSignals(headers) {
  const hasSecFetch = !!(
    headers['Sec-Fetch-Site'] ||
    headers['Sec-Fetch-Mode'] ||
    headers['Sec-Fetch-Dest']
  );

  const hasClientHints = !!(
    headers['Sec-Ch-Ua'] ||
    headers['Sec-Ch-Ua-Mobile'] ||
    headers['Sec-Ch-Ua-Platform']
  );

  const isMobile = headers['Sec-Ch-Ua-Mobile'] === '?1';

  return {
    has_sec_fetch_headers: hasSecFetch,
    has_client_hints: hasClientHints,
    is_mobile: isMobile
  };
}

// ============================================================================
// Bot-Specific Header Extraction
// ============================================================================

/**
 * Extract bot-specific headers
 * @param {Object} headers - Request headers
 * @returns {Object} Bot headers
 */
export function extractBotHeaders(headers) {
  return {
    bot_from_email: headers['From'] || null,
    openai_host_hash: headers['X-Openai-Host-Hash'] || null
  };
}

// ============================================================================
// Security Flag Detection
// ============================================================================

/**
 * Detect security flags (Cloudflare Worker, exploit attempts)
 * @param {Object} headers - Request headers
 * @param {string} path - Request path
 * @returns {Object} Security flags
 */
export function detectSecurityFlags(headers, path) {
  // Cloudflare Worker detection
  const hasCfWorker = !!headers['Cf-Worker'];
  const cfWorkerDomain = headers['Cf-Worker'] || null;

  // Exploit attempt detection (common attack paths)
  const exploitPaths = [
    '/wp-admin',
    '/wp-login',
    '/xmlrpc.php',
    '/.env',
    '/config.php',
    '/phpmyadmin',
    '/.git',
    '/admin',
    '/administrator'
  ];

  const isExploitAttempt = exploitPaths.some(p => path.startsWith(p));

  return {
    has_cf_worker: hasCfWorker,
    cf_worker_domain: cfWorkerDomain,
    is_exploit_attempt: isExploitAttempt
  };
}

// ============================================================================
// Testing
// ============================================================================

/**
 * Test classifier with known bot patterns
 */
export async function testClassifier() {
  console.log('\n=== Testing Bot Classifier ===');

  const testCases = [
    {
      name: 'GPTBot (Level 1)',
      event: {
        client_ip: '74.7.227.134',
        user_agent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
        headers: { 'From': 'gptbot@openai.com' }
      }
    },
    {
      name: 'ClaudeBot (Level 1)',
      event: {
        client_ip: '216.73.216.23',
        user_agent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
        headers: {}
      }
    },
    {
      name: 'Azure Stealth (Level 2)',
      event: {
        client_ip: '20.39.203.102',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        headers: {}
      }
    },
    {
      name: 'Google Cloud Stealth (Level 2)',
      event: {
        client_ip: '34.1.1.1',
        user_agent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
        headers: {}
      }
    },
    {
      name: 'Human Browser',
      event: {
        client_ip: '223.24.195.133',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        headers: {
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Ch-Ua-Mobile': '?0'
        }
      }
    }
  ];

  for (const testCase of testCases) {
    const result = await classify(testCase.event);
    console.log(`${testCase.name}:`, result);
  }

  console.log('===========================\n');
}
