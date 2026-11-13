import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BotError } from './errors.mjs';

const MAX_LINKS = 16;
const MAX_URL = 2048;
const MAX_TOKEN = 512;

export const isLoopback = request => {
  const address = String(request?.socket?.remoteAddress || '');
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
};

const endpoint = (value, label) => {
  const text = String(value ?? '').trim();
  if (!text) throw new BotError(`${label}不能为空`, 1400);
  if (text.length > MAX_URL) throw new BotError(`${label}过长`, 1400);
  let parsed;
  try { parsed = new URL(text); } catch { throw new BotError(`${label}不是合法 URL`, 1400); }
  if (!['ws:', 'wss:'].includes(parsed.protocol)) throw new BotError(`${label}必须以 ws:// 或 wss:// 开头`, 1400);
  if (parsed.username || parsed.password) throw new BotError(`${label}不允许包含用户名或密码`, 1400);
  return parsed.toString();
};

const token = value => {
  const text = String(value ?? '').trim();
  if (text.length > MAX_TOKEN) throw new BotError('Token 过长', 1400);
  return text;
};

/** Strict parse used when the page saves: anything malformed is rejected by name. */
export function sanitizeLinks(input) {
  if (!Array.isArray(input)) throw new BotError('links 必须是数组', 1400);
  if (input.length > MAX_LINKS) throw new BotError(`最多 ${MAX_LINKS} 条反向连接`, 1400);
  const seen = new Set();
  return input.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BotError(`第 ${index + 1} 条格式不正确`, 1400);
    const url = endpoint(raw.url, `第 ${index + 1} 条地址`);
    if (seen.has(url)) throw new BotError(`地址重复：${url}`, 1400);
    seen.add(url);
    const id = /^[a-f0-9]{8}$/.test(String(raw.id || '')) ? String(raw.id) : randomBytes(4).toString('hex');
    return { id, enable: raw.enable !== false, url, token: token(raw.token) };
  });
}

/** Lenient read: a hand-edited or older file must never stop the process. */
function coerce(raw) {
  try {
    if (!raw || typeof raw !== 'object') return null;
    const url = endpoint(raw.url, 'ADDRESS');
    return { id: /^[a-f0-9]{8}$/.test(String(raw.id || '')) ? String(raw.id) : randomBytes(4).toString('hex'),
      enable: raw.enable !== false, url, token: token(raw.token) };
  } catch { return null; }
}

export const networkFile = dataDir => join(dataDir, 'network.json');

/**
 * The .env values seed the list the first time only; after that the file is the
 * source of truth so the page and the environment cannot drift apart silently.
 */
export function readLinks(config) {
  const file = networkFile(config.dataDir);
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      if (Array.isArray(parsed?.links)) {
        return parsed.links.map(coerce).filter(Boolean).slice(0, MAX_LINKS);
      }
    } catch { /* fall back to the environment seed */ }
  }
  return (config.reverseUrls || []).slice(0, MAX_LINKS)
    .map(url => ({ id: randomBytes(4).toString('hex'), enable: true, url, token: '' }));
}

export function writeLinks(config, links) {
  const file = networkFile(config.dataDir);
  mkdirSync(dirname(file), { recursive: true });
  const payload = `${JSON.stringify({ version: 1, saved_at: new Date().toISOString(), links }, null, 2)}\n`;
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, payload, { mode: 0o600 });
  renameSync(temporary, file);
  return file;
}
