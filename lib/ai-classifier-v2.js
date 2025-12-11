/**
 * AI Bot Classifier V2 - Systematic Rule-Based Classification
 *
 * Classification Order:
 * 1. Rule out human (browser signals + behavior)
 * 2. Identify attack traffic (malicious intent)
 * 3. Categorize AI type (ChatGPT, Google, crawler, stealth)
 * 4. Fallback: Undetermined AI/Bot
 *
 * Philosophy: If it's not definitively human, it's not human.
 */

import { lookupASN, isDatacenterASN } from './asn-lookup.js';

// ============================================================================
// STAGE 1: HUMAN DETECTION RULES
// ============================================================================

/**
 * Determine if request is from a REAL HUMAN
 * A request is human ONLY if it passes ALL these checks:
 *
 * REQUIRED for Human Classification:
 * 1. Has Sec-Fetch-Site header (modern browsers ALWAYS send this)
 * 2. Has Client Hints OR proper Accept headers
 * 3. NOT from a datacenter (Azure/AWS/GCP)
 * 4. NOT using headless browser indicators
 * 5. Reasonable request rate (<0.5 req/sec sustained)
 *
 * @param {Object} event - Event data
 * @param {Object} headers - Request headers
 * @param {Object} sessionStats - Session statistics (optional)
 * @returns {boolean} true if definitely human, false otherwise
 */
function isDefinitelyHuman(event, headers, sessionStats = null) {
  // Rule 1: Must have Sec-Fetch-Site (100% indicator of real browser)
  const hasSecFetchSite = !!(
    headers['Sec-Fetch-Site'] ||
    headers['Sec-Fetch-Mode'] ||
    headers['Sec-Fetch-Dest']
  );

  if (!hasSecFetchSite) {
    return false; // FAIL: No Sec-Fetch headers = NOT a real browser
  }

  // Rule 2: Must have Client Hints OR proper Accept headers
  const hasClientHints = !!(
    headers['Sec-Ch-Ua'] ||
    headers['Sec-Ch-Ua-Mobile'] ||
    headers['Sec-Ch-Ua-Platform']
  );

  const hasProperAccept = !!(
    headers['Accept'] &&
    headers['Accept'].includes('text/html')
  );

  if (!hasClientHints && !hasProperAccept) {
    return false; // FAIL: Missing browser fingerprints
  }

  // Rule 3: Must NOT be from datacenter
  if (event.datacenter_provider) {
    return false; // FAIL: Datacenters don't host human users
  }

  // Rule 4: Check for headless browser indicators
  if (isHeadlessBrowser(event.user_agent, headers)) {
    return false; // FAIL: Headless browsers are automation tools
  }

  // Rule 5: Check request rate (if session stats available)
  if (sessionStats) {
    const { request_count, duration_seconds } = sessionStats;
    if (duration_seconds > 0) {
      const requestRate = request_count / duration_seconds;
      if (requestRate > 0.5) {
        return false; // FAIL: Humans don't make >0.5 req/sec sustained
      }
    }
  }

  // PASS: All human indicators present
  return true;
}

/**
 * Detect headless browser indicators
 * Headless browsers are 100% automation (Puppeteer, Playwright, Selenium)
 */
function isHeadlessBrowser(userAgent, headers) {
  if (!userAgent) return false;

  // Explicit headless indicators
  const headlessPatterns = [
    /HeadlessChrome/i,
    /Puppeteer/i,
    /Playwright/i,
    /Selenium/i,
    /PhantomJS/i,
    /SlimerJS/i,
    /electron/i
  ];

  for (const pattern of headlessPatterns) {
    if (pattern.test(userAgent)) {
      return true;
    }
  }

  // Chrome DevTools Protocol indicator
  if (headers['X-DevTools-Emulate-Network-Conditions-Client-Id']) {
    return true;
  }

  // Webdriver indicator
  if (headers['Webdriver'] || userAgent.includes('webdriver')) {
    return true;
  }

  return false;
}

// ============================================================================
// STAGE 2: ATTACK TRAFFIC DETECTION
// ============================================================================

/**
 * Identify malicious/attack traffic
 * Returns classification if malicious, null otherwise
 */
function detectAttackTraffic(event) {
  const { path, headers, user_agent } = event;

  // Category 1: WordPress/CMS Scanners
  const wordpressPatterns = [
    /^\/wp-admin/i,
    /^\/wp-login/i,
    /^\/wp\//i,
    /wp-config/i,
    /xmlrpc\.php/i,
    /wp-json\/wp\/v2\/users/i,
    /\/wp-content\/(plugins|themes)/i,
    /\/wp-includes\//i,
    /wp-cron\.php/i,
    /readme\.html$/i,
    /license\.txt$/i
  ];

  if (wordpressPatterns.some(p => p.test(path))) {
    return {
      is_bot: true,
      bot_classification: 'attack_wordpress_scanner',
      bot_name: 'WordPress-Scanner',
      detection_level: 1,
      detection_reason: 'WordPress vulnerability scanning'
    };
  }

  // Category 2: Web Shell / Backdoor Scanners
  const webshellPatterns = [
    /\.(php|asp|aspx|jsp)$/i,
    /alfa\.php/i,
    /c99\.php/i,
    /shell\.php/i,
    /cmd\.php/i,
    /admin\.php/i,
    /upload\.php/i,
    /ALFA_DATA/i,
    /alfacgiapi/i
  ];

  // Only flag as attack if it's a suspicious PHP file (not legitimate ones)
  if (webshellPatterns.some(p => p.test(path))) {
    // Check if path contains suspicious terms
    const suspiciousTerms = [
      'alfa', 'c99', 'shell', 'cmd', 'admin/upload',
      'ALFA_DATA', 'alfacgiapi', 'lock360', 'function.php'
    ];

    if (suspiciousTerms.some(term => path.toLowerCase().includes(term))) {
      return {
        is_bot: true,
        bot_classification: 'attack_webshell_scanner',
        bot_name: 'WebShell-Scanner',
        detection_level: 1,
        detection_reason: 'Web shell / backdoor scanning'
      };
    }
  }

  // Category 3: Configuration File Scanners
  const configPatterns = [
    /\/\.env/i,
    /\/config\.(php|json|yml|yaml)/i,
    /\/\.git/i,
    /\/\.svn/i,
    /phpmyadmin/i,
    /\/pma\//i,
    /dbadmin/i,
    /sqladmin/i,
    /mysqladmin/i
  ];

  if (configPatterns.some(p => p.test(path))) {
    return {
      is_bot: true,
      bot_classification: 'attack_config_scanner',
      bot_name: 'Config-Scanner',
      detection_level: 1,
      detection_reason: 'Configuration file / database scanner'
    };
  }

  // Category 4: Exploit Attempt Scanners
  const exploitPatterns = [
    /\.\.(\/|\\)/,  // Directory traversal
    /<script>/i,     // XSS attempt
    /union.*select/i, // SQL injection
    /eval\(/i,       // Code injection
    /base64_decode/i,
    /system\(/i,
    /exec\(/i,
    /passthru\(/i
  ];

  if (exploitPatterns.some(p => p.test(path))) {
    return {
      is_bot: true,
      bot_classification: 'attack_exploit_attempt',
      bot_name: 'Exploit-Scanner',
      detection_level: 1,
      detection_reason: 'Active exploit attempt detected'
    };
  }

  // Category 5: High-velocity scanner (many requests, many random paths)
  // This is handled in behavioral analysis below

  return null; // Not attack traffic
}

// ============================================================================
// STAGE 3: AI TYPE CATEGORIZATION
// ============================================================================

/**
 * Official AI Bots (declared in User-Agent)
 */
const OFFICIAL_AI_BOTS = {
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

  // Meta
  'Meta-ExternalAgent': /Meta-ExternalAgent/i,
  'Meta-ExternalFetcher': /Meta-ExternalFetcher/i,

  // Others
  'Amazonbot': /Amazonbot/i,
  'Applebot-Extended': /Applebot-Extended/i,
  'Bytespider': /Bytespider/i,
  'YouBot': /YouBot/i
};

/**
 * Traditional Web Crawlers (SEO, social media, etc.)
 */
const WEB_CRAWLERS = {
  'Googlebot': /Googlebot/i,
  'Bingbot': /bingbot/i,
  'Yahoo-Slurp': /Yahoo.*Slurp/i,
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
  'TelegramBot': /TelegramBot/i,
  'Applebot': /Applebot(?!-Extended)/i  // Regular Applebot (not Extended)
};

/**
 * Monitoring & Infrastructure Services
 * Uptime monitors, availability checks, Cloudflare verification, etc.
 */
const MONITORING_SERVICES = {
  // Infrastructure
  'Cloudflare-Verify': /Cloudflare.*Verification/i,
  'Cloudflare-Health': /Cloudflare.*Health/i,

  // Uptime monitoring services
  'UptimeRobot': /UptimeRobot/i,
  'Pingdom': /Pingdom/i,
  'StatusCake': /StatusCake/i,
  'Site24x7': /Site24x7/i,
  'Uptime.com': /Uptime\.com/i,
  'Freshping': /Freshping/i,

  // Generic monitoring patterns
  'Monitor': /^Monitor/i,
  'Uptime-Check': /uptime.*check/i,
  'Availability-Check': /availability.*check/i
};

/**
 * Categorize known AI bot by User-Agent
 */
function categorizeOfficialAI(userAgent) {
  if (!userAgent) return null;

  // Check official AI bots
  for (const [name, pattern] of Object.entries(OFFICIAL_AI_BOTS)) {
    if (pattern.test(userAgent)) {
      return {
        is_bot: true,
        bot_classification: 'ai_official',
        bot_name: name,
        detection_level: 1,
        detection_reason: 'Official AI bot declared in User-Agent'
      };
    }
  }

  return null;
}

/**
 * Categorize monitoring/uptime service
 */
function categorizeMonitoring(event) {
  const userAgent = event.user_agent;
  const path = event.path;

  // Check for explicit monitoring service User-Agents
  if (userAgent) {
    for (const [name, pattern] of Object.entries(MONITORING_SERVICES)) {
      if (pattern.test(userAgent)) {
        return {
          is_bot: true,
          bot_classification: 'monitoring_service',
          bot_name: name,
          detection_level: 2,
          detection_reason: 'Uptime/monitoring service'
        };
      }
    }
  }

  // Cloudflare hostname verification (by path pattern OR User-Agent)
  if ((path && path.includes('.well-known/cf-custom-hostname-challenge')) ||
      (userAgent && /Cloudflare.*Custom.*Hostname/i.test(userAgent))) {
    return {
      is_bot: true,
      bot_classification: 'monitoring_service',
      bot_name: 'Cloudflare-Verify',
      detection_level: 2,
      detection_reason: 'Cloudflare custom hostname verification'
    };
  }

  // Behavioral detection: Datacenter + no UA + simple root paths
  // This catches availability checks, uptime monitors without declared UAs
  const simpleRootPaths = ['/', '/robots.txt', '/favicon.ico', '/index.html', '/sitemap.xml'];
  if (event.datacenter_provider &&
      (!userAgent || userAgent === '') &&
      simpleRootPaths.includes(path)) {
    const providerName = event.datacenter_provider.toUpperCase();
    return {
      is_bot: true,
      bot_classification: 'monitoring_service',
      bot_name: `${providerName}-Monitor`,
      detection_level: 2,
      detection_reason: `${event.datacenter_provider} availability check (no UA, simple path)`
    };
  }

  return null;
}

/**
 * Categorize traditional web crawler
 */
function categorizeWebCrawler(userAgent) {
  if (!userAgent) return null;

  // Check web crawlers
  for (const [name, pattern] of Object.entries(WEB_CRAWLERS)) {
    if (pattern.test(userAgent)) {
      return {
        is_bot: true,
        bot_classification: 'web_crawler',
        bot_name: name,
        detection_level: 1,
        detection_reason: 'Traditional web crawler'
      };
    }
  }

  // Headless browser detection (automation tools)
  if (isHeadlessBrowser(userAgent, {})) {
    return {
      is_bot: true,
      bot_classification: 'web_crawler',
      bot_name: 'Headless-Browser',
      detection_level: 1,
      detection_reason: 'Headless browser automation detected'
    };
  }

  // Generic bot patterns
  if (/bot|crawler|spider|scraper|curl|wget|python|java|http/i.test(userAgent)) {
    return {
      is_bot: true,
      bot_classification: 'web_crawler',
      bot_name: 'Generic-Crawler',
      detection_level: 1,
      detection_reason: 'Generic bot/crawler pattern in User-Agent'
    };
  }

  return null;
}

/**
 * Detect datacenter systematic crawlers
 * These are bots that:
 * - Run from datacenters
 * - Have NO User-Agent (or minimal UA)
 * - Access non-root paths (not just / or /robots.txt)
 * - Are systematically crawling content
 */
function detectDatacenterCrawler(event) {
  const { datacenter_provider, user_agent, path } = event;

  // Must be from datacenter
  if (!datacenter_provider) return null;

  // Must have NO User-Agent or very minimal UA
  if (user_agent && user_agent.length > 50) return null;

  // Must NOT be a simple root path (those are monitoring)
  const simpleRootPaths = ['/', '/robots.txt', '/favicon.ico', '/index.html', '/sitemap.xml'];
  if (!path || simpleRootPaths.includes(path)) return null;

  // This is a datacenter systematic crawler
  const providerName = datacenter_provider.toUpperCase();
  return {
    is_bot: true,
    bot_classification: 'ai_stealth',
    bot_name: `${providerName}-Crawler`,
    detection_level: 2,
    detection_reason: `${datacenter_provider} datacenter + no UA + content path (systematic crawling)`
  };
}

/**
 * Detect stealth AI crawlers
 * These are bots that:
 * - Run from datacenters
 * - Use browser-like User-Agents (spoofing)
 * - Missing Sec-Fetch headers
 * - No explicit bot declaration
 */
function detectStealthAI(event, headers) {
  const { datacenter_provider, user_agent } = event;

  // Must be from datacenter
  if (!datacenter_provider) return null;

  // Must have browser-like UA (they're trying to hide)
  if (!isBrowserUA(user_agent)) return null;

  // Must be missing Sec-Fetch headers (proves it's not a real browser)
  const hasSecFetch = !!(
    headers['Sec-Fetch-Site'] ||
    headers['Sec-Fetch-Mode'] ||
    headers['Sec-Fetch-Dest']
  );

  if (hasSecFetch) return null; // Has real browser headers, not stealth

  // This is a stealth AI crawler
  return {
    is_bot: true,
    bot_classification: 'ai_stealth',
    bot_name: `${datacenter_provider.toUpperCase()}-Stealth-AI`,
    detection_level: 2,
    detection_reason: 'Datacenter + browser UA + missing Sec-Fetch headers'
  };
}

/**
 * Check if User-Agent looks like a browser
 */
function isBrowserUA(userAgent) {
  if (!userAgent) return false;

  return (
    userAgent.includes('Mozilla') &&
    (userAgent.includes('Chrome') ||
     userAgent.includes('Safari') ||
     userAgent.includes('Firefox') ||
     userAgent.includes('Edge'))
  );
}

// ============================================================================
// STAGE 4: UNDETERMINED BOT FALLBACK
// ============================================================================

/**
 * If we get here, it's not human but we don't know what it is
 */
function classifyAsUndetermined(event) {
  const reason = determineUndeterminedReason(event);

  return {
    is_bot: true,
    bot_classification: 'bot_undetermined',
    bot_name: 'Undetermined-Bot',
    detection_level: 3,
    detection_reason: reason
  };
}

function determineUndeterminedReason(event) {
  const reasons = [];

  if (!event.user_agent || event.user_agent === '') {
    reasons.push('No User-Agent');
  }

  if (event.datacenter_provider) {
    reasons.push(`Datacenter: ${event.datacenter_provider}`);
  }

  if (!event.headers || !event.headers['Sec-Fetch-Site']) {
    reasons.push('Missing Sec-Fetch headers');
  }

  if (reasons.length === 0) {
    return 'Failed human verification checks';
  }

  return reasons.join(', ');
}

// ============================================================================
// MAIN CLASSIFICATION FUNCTION
// ============================================================================

/**
 * Classify request using systematic 4-stage approach
 *
 * @param {Object} event - Event data
 * @returns {Promise<Object>} Classification result
 */
export async function classify(event) {
  const headers = event.headers || {};

  // STAGE 1: Rule out human
  // If it passes all human checks, classify as human and STOP
  const sessionStats = event.sessionStats || null;
  if (isDefinitelyHuman(event, headers, sessionStats)) {
    return {
      is_bot: false,
      bot_classification: 'human',
      bot_name: null,
      detection_level: null,
      detection_reason: 'Passed all human verification checks'
    };
  }

  // Not human, continue to bot classification...

  // STAGE 2: Identify attack traffic
  const attackClassification = detectAttackTraffic(event);
  if (attackClassification) return attackClassification;

  // STAGE 3: Categorize bot type

  // 3A: Official AI bots (declared)
  const officialAI = categorizeOfficialAI(event.user_agent);
  if (officialAI) return officialAI;

  // 3B: Traditional web crawlers
  const webCrawler = categorizeWebCrawler(event.user_agent);
  if (webCrawler) return webCrawler;

  // 3C: Monitoring & infrastructure services
  const monitoring = categorizeMonitoring(event);
  if (monitoring) return monitoring;

  // 3D: Datacenter systematic crawlers (no UA + content paths)
  const datacenterCrawler = detectDatacenterCrawler(event);
  if (datacenterCrawler) return datacenterCrawler;

  // 3E: Stealth AI (datacenter + spoofed UA)
  const stealthAI = detectStealthAI(event, headers);
  if (stealthAI) return stealthAI;

  // STAGE 4: Undetermined bot (we know it's not human, but can't categorize)
  return classifyAsUndetermined(event);
}

// ============================================================================
// HELPER FUNCTIONS FOR INGESTION
// ============================================================================

/**
 * Detect browser signals (Sec-Fetch, Client Hints)
 * @param {Object} headers - Request headers
 * @returns {Object} Browser signals
 */
export function detectBrowserSignals(headers) {
  const hasSecFetch = !!(
    headers['Sec-Fetch-Site'] ||
    headers['Sec-Fetch-Mode'] ||
    headers['Sec-Fetch-Dest'] ||
    headers['Sec-Fetch-User']
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

/**
 * Detect security flags
 * @param {Object} headers - Request headers
 * @param {string} path - Request path
 * @returns {Object} Security flags
 */
export function detectSecurityFlags(headers, path) {
  const hasCfWorker = !!headers['Cf-Worker'];
  const cfWorkerDomain = headers['Cf-Worker'] || null;

  // Use the attack detection logic
  const attackResult = detectAttackTraffic({ path, headers });
  const isExploitAttempt = !!attackResult;

  return {
    has_cf_worker: hasCfWorker,
    cf_worker_domain: cfWorkerDomain,
    is_exploit_attempt: isExploitAttempt
  };
}

// ============================================================================
// TESTING
// ============================================================================

/**
 * Test classifier with known patterns
 */
export async function testClassifier() {
  console.log('\n=== Testing Bot Classifier V2 ===\n');

  const testCases = [
    {
      name: '1. Real Human (has Sec-Fetch + Client Hints)',
      event: {
        client_ip: '50.24.28.1',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        headers: {
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Ch-Ua': '"Chrome";v="120"',
          'Accept': 'text/html'
        },
        datacenter_provider: null
      }
    },
    {
      name: '2. Headless Chrome (100% bot)',
      event: {
        client_ip: '50.24.28.2',
        user_agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0.0.0',
        headers: {
          'Sec-Fetch-Site': 'none'
        },
        datacenter_provider: null
      }
    },
    {
      name: '3. GPTBot (Official AI)',
      event: {
        client_ip: '74.7.227.134',
        user_agent: 'Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.2)',
        headers: {},
        datacenter_provider: null
      }
    },
    {
      name: '4. Azure Stealth AI (no Sec-Fetch)',
      event: {
        client_ip: '20.39.203.102',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        headers: {},
        datacenter_provider: 'azure'
      }
    },
    {
      name: '5. WordPress Scanner',
      event: {
        client_ip: '1.2.3.4',
        user_agent: 'curl/7.68.0',
        path: '/wp-admin/admin.php',
        headers: {},
        datacenter_provider: null
      }
    },
    {
      name: '6. Web Shell Scanner',
      event: {
        client_ip: '1.2.3.5',
        user_agent: null,
        path: '/alfa.php',
        headers: {},
        datacenter_provider: 'azure'
      }
    },
    {
      name: '7. Googlebot (Web Crawler)',
      event: {
        client_ip: '66.249.64.1',
        user_agent: 'Mozilla/5.0 (compatible; Googlebot/2.1)',
        headers: {},
        datacenter_provider: null
      }
    },
    {
      name: '8. No UA + Datacenter = Undetermined',
      event: {
        client_ip: '172.207.9.124',
        user_agent: null,
        headers: {},
        datacenter_provider: 'azure'
      }
    },
    {
      name: '9. Residential IP but no Sec-Fetch = Undetermined',
      event: {
        client_ip: '50.24.28.220',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0',
        headers: {},
        datacenter_provider: null
      }
    }
  ];

  for (const testCase of testCases) {
    const result = await classify(testCase.event);
    console.log(`${testCase.name}:`);
    console.log(`  Classification: ${result.bot_classification}`);
    console.log(`  Bot Name: ${result.bot_name || 'N/A'}`);
    console.log(`  Reason: ${result.detection_reason || 'N/A'}`);
    console.log('');
  }

  console.log('=== End Test ===\n');
}
