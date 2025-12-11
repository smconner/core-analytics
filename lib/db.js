/**
 * Database Module
 * PostgreSQL connection and query utilities
 */

import pg from 'pg';
const { Pool } = pg;

let pool;

/**
 * Initialize database connection pool
 * @param {Object} config - Database configuration
 * @param {string} config.host - Database host
 * @param {number} config.port - Database port
 * @param {string} config.database - Database name
 * @param {string} config.user - Database user
 * @param {string} config.password - Database password
 */
export function initDB(config) {
  pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  });

  // Log connection errors
  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });

  console.log(`Database pool initialized: ${config.database}@${config.host}`);
}

/**
 * Batch insert events into the database
 * @param {Array} events - Array of event objects
 * @returns {Promise<number>} Number of inserted records
 */
export async function batchInsert(events) {
  if (!events || events.length === 0) {
    return 0;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Build parameterized query
    const fields = [
      'timestamp', 'duration', 'client_ip', 'country', 'city', 'latitude', 'longitude',
      'cf_ray', 'subnet', 'asn', 'asn_org', 'datacenter_provider', 'site', 'method',
      'path', 'query_string', 'status', 'response_size', 'content_type', 'user_agent',
      'is_bot', 'bot_classification', 'bot_name', 'detection_level', 'referer',
      'accept_language', 'has_sec_fetch_headers', 'has_client_hints', 'is_mobile',
      'bot_from_email', 'openai_host_hash', 'has_cf_worker', 'cf_worker_domain',
      'is_exploit_attempt', 'headers_json'
    ];

    // Generate placeholder strings for each record
    const valueStrings = events.map((_, i) => {
      const offset = i * fields.length;
      const placeholders = fields.map((_, j) => `$${offset + j + 1}`).join(', ');
      return `(${placeholders})`;
    }).join(',\n  ');

    // Flatten all values
    const flatValues = events.flatMap(e => [
      e.timestamp,
      e.duration,
      e.client_ip,
      e.country,
      e.city,
      e.latitude,
      e.longitude,
      e.cf_ray,
      e.subnet,
      e.asn,
      e.asn_org,
      e.datacenter_provider,
      e.site,
      e.method,
      e.path,
      e.query_string,
      e.status,
      e.response_size,
      e.content_type,
      e.user_agent,
      e.is_bot,
      e.bot_classification,
      e.bot_name,
      e.detection_level,
      e.referer,
      e.accept_language,
      e.has_sec_fetch_headers,
      e.has_client_hints,
      e.is_mobile,
      e.bot_from_email,
      e.openai_host_hash,
      e.has_cf_worker,
      e.cf_worker_domain,
      e.is_exploit_attempt,
      e.headers_json ? JSON.stringify(e.headers_json) : null
    ]);

    const query = `
      INSERT INTO events (
        ${fields.join(', ')}
      ) VALUES
      ${valueStrings}
    `;

    await client.query(query, flatValues);
    await client.query('COMMIT');

    return events.length;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Batch insert error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get the last processed timestamp from ingestion_state
 * @returns {Promise<Date|null>} Last processed timestamp or null if no records
 */
export async function getLastProcessedTimestamp() {
  const result = await pool.query(`
    SELECT last_processed_timestamp
    FROM ingestion_state
    ORDER BY created_at DESC
    LIMIT 1
  `);

  return result.rows[0]?.last_processed_timestamp || null;
}

/**
 * Update ingestion state with latest processed information
 * @param {Date} timestamp - Latest processed timestamp
 * @param {string} cfRay - Latest Cf-Ray value
 * @param {number} recordsProcessed - Number of records processed
 * @param {number} duration - Duration in milliseconds
 */
export async function updateIngestionState(timestamp, cfRay, recordsProcessed, duration) {
  await pool.query(`
    INSERT INTO ingestion_state (
      last_processed_timestamp,
      last_cf_ray,
      records_processed,
      ingestion_duration_ms
    ) VALUES ($1, $2, $3, $4)
  `, [timestamp, cfRay, recordsProcessed, duration]);
}

/**
 * Execute a raw query
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
export async function query(sql, params = []) {
  return await pool.query(sql, params);
}

/**
 * Close database pool
 */
export async function closeDB() {
  if (pool) {
    await pool.end();
    console.log('Database pool closed');
  }
}

/**
 * Test database connection
 * @returns {Promise<boolean>} True if connection successful
 */
export async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW() as now, version() as version');
    console.log('Database connection successful');
    console.log('Server time:', result.rows[0].now);
    console.log('PostgreSQL version:', result.rows[0].version.split('\n')[0]);
    return true;
  } catch (err) {
    console.error('Database connection failed:', err.message);
    return false;
  }
}
