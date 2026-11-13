import { resolve } from 'node:path';
import { resolveQQRuntime } from './qq/runtime-location.mjs';

function number(env, key, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(env[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
  return value;
}
function bool(env, key, fallback = false) {
  if (env[key] === undefined || env[key] === '') return fallback;
  if (!['true', 'false'].includes(env[key])) throw new Error(`${key} must be true or false`);
  return env[key] === 'true';
}
function endpoint(value, schemes, name) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`Invalid ${name}`); }
  if (!schemes.includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`Invalid ${name} (credentials in URLs are not allowed)`);
  }
  return parsed.toString();
}

/**
 * The protocol side keeps only what OneBot and the QQ kernel host need.
 * There is no model endpoint, plugin catalog, agent or web console here.
 */
export function loadConfig(env = process.env) {
  const token = env.ONEBOT_ACCESS_TOKEN ?? '';
  if (token.length < 24) throw new Error('ONEBOT_ACCESS_TOKEN must contain at least 24 characters; run npm run init');
  const adminToken = env.ADMIN_ACCESS_TOKEN ?? '';
  if (adminToken.length < 24) throw new Error('ADMIN_ACCESS_TOKEN must contain at least 24 characters; run npm run init');
  if (adminToken === token) throw new Error('ADMIN_ACCESS_TOKEN must differ from ONEBOT_ACCESS_TOKEN');
  const reverseToken = env.REVERSE_WS_TOKEN || token;
  if (adminToken === reverseToken) throw new Error('ADMIN_ACCESS_TOKEN must differ from REVERSE_WS_TOKEN');
  const sessionKey = env.MEDIA_SECRET || env.SESSION_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(sessionKey)) throw new Error('MEDIA_SECRET must be a random 32-byte hex key; run npm run init');
  const mediaBaseUrl = env.MEDIA_BASE_URL
    ? endpoint(env.MEDIA_BASE_URL, ['http:', 'https:'], 'MEDIA_BASE_URL').replace(/\/$/, '')
    : '';
  if (mediaBaseUrl && new URL(mediaBaseUrl).pathname !== '/') throw new Error('MEDIA_BASE_URL must be an origin without a path');

  const dataDir = resolve(env.DATA_DIR || './data');
  const kickedReconnect = String(env.QQ_KICKED_RECONNECT || 'manual').trim().toLowerCase();
  if (!['manual', 'auto'].includes(kickedReconnect)) throw new Error('QQ_KICKED_RECONNECT must be manual or auto');
  return {
    host: env.HOST || '127.0.0.1',
    port: number(env, 'PORT', 5700, 0, 65535),
    token, adminToken, reverseToken, sessionKey,
    dataDir,
    driver: 'kernel',
    account: number(env, 'QQ_ACCOUNT', 0),
    rpcTimeout: number(env, 'QQ_RPC_TIMEOUT_MS', 20000, 10),
    startupTimeout: number(env, 'QQ_STARTUP_TIMEOUT_MS', 90000, 10, 300000),
    maxRequestBytes: number(env, 'ONEBOT_MAX_REQUEST_BYTES', 16 * 1024 * 1024, 1024 * 1024, 128 * 1024 * 1024),
    media: {
      baseUrl: mediaBaseUrl,
      maxBytes: number(env, 'MEDIA_MAX_BYTES', 30 * 1024 * 1024, 1024, 50 * 1024 * 1024),
      timeout: number(env, 'MEDIA_TIMEOUT_MS', 120000, 1000, 300000),
      retentionDays: number(env, 'MEDIA_CACHE_DAYS', 7, 1, 365)
    },
    kernel: {
      runtime: resolveQQRuntime(env.QQ_RUNTIME_DIR),
      directory: resolve(env.QQ_KERNEL_DIR || './runtime/kernel'),
      data: resolve(env.QQ_KERNEL_DATA || `${env.DATA_DIR || './data'}/qq-kernel`),
      source: String(env.QQ_RUNTIME_SOURCE || 'download').trim().toLowerCase() === 'local' ? 'local' : 'download',
      shutdownTimeout: number(env, 'QQ_SHUTDOWN_TIMEOUT_MS', 5000, 100, 20000),
      // A kicked session is not a network outage. Automatic quick login turns a
      // single kick into a login→kick loop, which is exactly what risk control
      // reacts to; manual re-authentication is the safe default.
      kickedReconnect
    },
    heartbeatMs: number(env, 'HEARTBEAT_MS', 30000, 1000),
    reverseUrls: String(env.REVERSE_WS_URLS || '').split(',').map(value => value.trim()).filter(Boolean)
      .map(value => endpoint(value, ['ws:', 'wss:'], 'REVERSE_WS_URLS')),
    webhookUrl: env.WEBHOOK_URL ? endpoint(env.WEBHOOK_URL, ['http:', 'https:'], 'WEBHOOK_URL') : '',
    webhookSecret: env.WEBHOOK_SECRET || '',
    sendInterval: number(env, 'SEND_INTERVAL_MS', 1200),
    sessionInterval: number(env, 'SESSION_INTERVAL_MS', 2500),
    sendConcurrency: number(env, 'SEND_CONCURRENCY', 4, 1, 16),
    maxPendingSends: number(env, 'MAX_PENDING_SENDS', 1000, 1, 10000),
    retentionDays: number(env, 'HISTORY_RETENTION_DAYS', 0, 0),
    qrPage: bool(env, 'QR_PAGE_ENABLED', true)
  };
}
