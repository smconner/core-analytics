# Expanded ASN Detection System

## Overview

The ASN (Autonomous System Number) detection system has been expanded from tracking 9 major cloud providers to tracking 50+ cloud, hosting, and datacenter providers, plus pattern-based detection for any provider with hosting-related keywords in their organization name.

## What Changed

### Before (9 providers)
- Microsoft Azure
- Google Cloud Platform
- Amazon AWS
- Cloudflare
- OVH
- DigitalOcean
- Vultr
- Linode
- Hetzner

### After (50+ providers)

#### Major Cloud Providers (Added)
- **Tencent Cloud** (437 requests detected)
- **Alibaba Cloud** (24 requests)
- **Huawei Cloud** (75 requests)
- **Baidu Cloud**

#### Telecom IDC/Cloud Services (Added)
- CHINANET IDC networks (5 ASNs)
- China Telecommunications IDC

#### Hosting/VPS Providers (Added)
- 13 specific hosting companies (109 requests total)
- Examples: NAVER Cloud, COLOCROSSING, EGIHOSTING, etc.

#### Pattern-Based Detection (New Feature)
Any ASN organization with these keywords is automatically detected as datacenter/hosting:
- `cloud`
- `hosting`
- `server`
- `datacenter` / `data center`
- `vps`
- `compute`
- `infrastructure`
- `colocation` / `colo`
- `idc` (Internet Data Center)
- `cdn` (Content Delivery Network)

## Impact of Changes

### Reclassification Results

**From recent reclassification run:**
- **2,258 events** checked for updated datacenter status
- **1,008 events** (44.6%) newly detected as datacenters
- **588 events** (26%) reclassified from other categories

**Distribution Changes:**

| Category | Before | After | Change |
|----------|--------|-------|--------|
| Undetermined Bot | 69.3% | 63.8% | **-5.5%** |
| AI Stealth | 2.6% | 8.1% | **+5.5%** |
| Human | 2.3% | 2.2% | -0.1% |
| Web Crawler | 18.2% | 18.2% | No change |
| Official AI | 7.0% | 7.0% | No change |

**Key Finding:** 582 events previously marked as "Undetermined Bot" (datacenter + no UA) are now correctly classified as "AI Stealth" because we can now identify their datacenter origin.

### Newly Detected Providers

| Provider | Requests | Unique IPs | Top Organizations |
|----------|----------|------------|-------------------|
| Tencent | 437 | 207 | Tencent Building, Kejizhongyi Avenue |
| Hosting (generic) | 109 | 40 | COLOCROSSING, Cloud Computing Corp |
| Huawei | 75 | 17 | HUAWEI CLOUDS |
| Telecom Cloud | 39 | 10 | CHINANET IDC networks |
| Alibaba | 24 | 21 | Alibaba US Technology |

## How It Works

### 1. Explicit ASN Mapping

The system checks a hardcoded list of known datacenter ASNs:

```javascript
const DATACENTER_ASN = {
  8075: 'azure',
  132203: 'tencent',
  136907: 'huawei',
  // ... 50+ total mappings
};
```

### 2. Pattern Matching (Fallback)

If ASN is not in the explicit list, check organization name:

```javascript
const DATACENTER_PATTERNS = [
  /\bcloud\b/i,
  /\bhosting\b/i,
  /\bserver\b/i,
  // ... 13 total patterns
];

if (DATACENTER_PATTERNS.some(pattern => pattern.test(org_name))) {
  datacenter_provider = 'hosting';
}
```

### 3. Classification Impact

**In the V2 classifier:**
```javascript
// Stage 1: Rule out human
if (event.datacenter_provider) {
  return false; // NOT human - datacenters don't host real users
}

// Stage 3C: Stealth AI detection
if (datacenter_provider && !has_sec_fetch_headers) {
  return 'ai_stealth'; // Datacenter + spoofed UA = stealth AI
}
```

## Benefits

### 1. More Accurate Human Detection
- 8 fewer false positives (humans from datacenters)
- Stricter enforcement: datacenters NEVER host real human users

### 2. Better AI Stealth Detection
- 582 previously undetermined bots now correctly classified
- Can identify Chinese cloud providers (major AI training source)

### 3. Comprehensive Coverage
- Pattern matching catches new/unknown hosting providers automatically
- No need to manually add every small VPS company

### 4. Geographic Diversity
- Better detection of Asian cloud providers (Tencent, Alibaba, Huawei)
- Telecom IDC networks now recognized

## Files Modified

1. **`lib/asn-lookup.js`**
   - Expanded `DATACENTER_ASN` from 9 to 50+ providers
   - Added `DATACENTER_PATTERNS` for pattern matching
   - Updated `lookupASN()` to check patterns as fallback

2. **New Scripts:**
   - `scripts/identify-hosting-providers.js` - Report generator
   - `scripts/reclassify-with-expanded-asn.js` - Reclassification tool

## Usage

### Generate Report of Hosting Providers
```bash
node scripts/identify-hosting-providers.js
```

### Reclassify Existing Data
```bash
node scripts/reclassify-with-expanded-asn.js
```

### Future Ingestion
New events are automatically classified using the expanded list and pattern matching. No additional configuration needed.

## Maintenance

### Adding New Providers

**Option 1: Explicit ASN (Recommended for major providers)**
```javascript
// In lib/asn-lookup.js
const DATACENTER_ASN = {
  // ... existing entries
  12345: 'new-provider-name'  // Add new ASN
};
```

**Option 2: Pattern Matching (Automatic)**
If the organization name contains hosting-related keywords, it's automatically detected. No code changes needed.

### Checking Detection

```bash
# See what providers are detected in your data
node -e "import('./lib/db.js').then(async (db) => {
  db.initDB(config.database);
  const result = await db.query(\"
    SELECT datacenter_provider, COUNT(*)
    FROM events
    WHERE datacenter_provider IS NOT NULL
    GROUP BY datacenter_provider
    ORDER BY COUNT(*) DESC;
  \");
  console.table(result.rows);
});"
```

## Known Limitations

### Still Not Detected

These types of IPs may still show as "residential":

1. **VPN Services** - Use residential IP ranges
2. **Residential Proxies** - Legitimate ISP IPs used for proxying
3. **Small Hosting Companies** - Not in our list and don't use hosting keywords
4. **Mobile Device Farms** - Look like mobile carriers
5. **Compromised Residential Devices** - Actual residential IPs controlled by bots

### False Positives

Pattern matching may incorrectly flag:
- ISPs with "cloud" in their name (rare)
- Organizations using "server" in non-hosting context

**Mitigation:** Explicit ASN list takes priority over pattern matching, so known ISPs can be excluded.

## Statistics

**From your current database:**
- Total events with datacenter providers: **2,550** (24.4%)
- Previously undetected: **1,008** (39.5% increase)
- Most common: Tencent (437), Huawei (75), Azure (existing)

**Coverage improvement:**
- Before: 9 providers, ~1,500 events detected
- After: 50+ providers + patterns, ~2,550 events detected
- **70% increase in datacenter detection**

---

## Version History

- **v1.0** (Initial) - 9 major cloud providers
- **v1.1** (2025-11-12) - Expanded to 50+ providers with pattern matching
