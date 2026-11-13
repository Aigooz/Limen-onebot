import { createServer } from 'node:http';
import { createHash, timingSafeEqual, createHmac, randomBytes } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { listenHTTP } from './listen-http.mjs';
import { BotError, ok, failure } from './errors.mjs';
import { boolean } from './messages.mjs';
import { checkKernelUpdate } from './qq/kernel/update.mjs';
import { renderLoginPage } from './login-page.mjs';
import { isLoopback, readLinks, sanitizeLinks, writeLinks } from './network.mjs';
import { PROJECT_ID, PROJECT_NAME } from './brand.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const VERSION = '0.1.0';
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
function authorize(req, url, expected, { allowQuery = true } = {}) {
  if (typeof expected !== 'string' || !expected.length) return false;
  const header = req.headers.authorization || '';
  const match = /^(?:Bearer|Token) (.+)$/i.exec(header);
  return equal(match?.[1] || (allowQuery ? url.searchParams.get('access_token') : '') || '', expected);
}
async function body(req, maxBytes = MAX_BYTES) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) throw new BotError('Request body exceeds ONEBOT_MAX_REQUEST_BYTES', 1400);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  if ((req.headers['content-type'] || '').split(';')[0] === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(text));
  }
  let value;
  try { value = JSON.parse(text); } catch { throw new BotError('Invalid request JSON', 1400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BotError('Request body must be an object', 1400);
  return value;
}
function respond(res, code, value) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function html(res, code, text) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
  res.end(text);
}
const httpCode = error => [1400, 1404].includes(error.code) ? error.code - 1000 : error.code ? 200 : 500;
function send(ws, value) {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > MAX_BYTES) { ws.close(1008, 'Slow consumer'); return; }
  ws.send(JSON.stringify(value), error => { if (error) ws.terminate(); });
}

export class OneBotServer {
  constructor({ adapter, config, log, store }) {
    Object.assign(this, { adapter, config, log, store });
    this.clients = new Map(); this.reverse = new Map(); this.closed = false;
    this.links = readLinks(config);
    this.controller = new AbortController(); this.webhookTail = Promise.resolve(); this.webhookPending = 0;
    this.startedAt = Date.now();
    this.pageToken = randomBytes(16).toString('hex');
    this.server = createServer((req, res) => { this.http(req, res).catch(error => respond(res, 500, failure(error))); });
    this.server.requestTimeout = 30000; this.server.headersTimeout = 10000;
    this.wsServer = new WebSocketServer({ noServer: true, maxPayload: config.maxRequestBytes || MAX_BYTES });
    this.server.on('upgrade', (req, socket, head) => {
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
      const path = url.pathname.replace(/\/$/, '') || '/';
      if (!authorize(req, url, config.token)) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
      if (!['/', '/api', '/event'].includes(path)) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
      this.wsServer.handleUpgrade(req, socket, head, ws => this.attach(ws, path !== '/api', path !== '/event'));
    });
    this.onEvent = event => { try { this.broadcast(event); } catch { this.log('error', 'event_broadcast_failed'); } };
    this.onOutgoing = event => { try { this.broadcast(event); } catch {} };
    this.onState = () => {
      this.broadcast(this.meta('lifecycle', { sub_type: adapter.status().online ? 'enable' : 'disable' }));
      this.syncReverse();
    };
    adapter.on('event', this.onEvent); adapter.on('outgoing', this.onOutgoing); adapter.on('state', this.onState);
  }
  meta(type, fields = {}) {
    return { time: Math.floor(Date.now() / 1000), self_id: this.adapter.driver.account,
      post_type: 'meta_event', meta_event_type: type, ...fields };
  }
  async start() {
    await listenHTTP(this.server, this.config.port, this.config.host);
    const address = this.server.address();
    const boundHost = ['0.0.0.0', 'localhost'].includes(this.config.host) ? '127.0.0.1'
      : this.config.host === '::' ? '::1' : this.config.host;
    const host = boundHost.includes(':') && !boundHost.startsWith('[') ? `[${boundHost}]` : boundHost;
    this.adapter.driver.images?.setOrigin(`http://${host}:${address.port}`);
    this.heartbeat = setInterval(() => this.broadcast(this.meta('heartbeat', {
      status: this.adapter.status(), interval: this.config.heartbeatMs })), this.config.heartbeatMs);
    this.pingTimer = setInterval(() => {
      for (const [ws, client] of this.clients) {
        if (!client.alive) { ws.terminate(); continue; }
        client.alive = false; ws.ping();
      }
    }, 30000);
    this.syncReverse();
    return this.server.address();
  }
  loginUrl(origin) {
    return `${origin}/login/${this.pageToken}`;
  }
  reverseInfo() {
    const dedicated = this.config.reverseToken && this.config.reverseToken !== this.config.token;
    return {
      connected: [...this.reverse.values()].filter(entry => entry.connected).length,
      shared: !dedicated,
      token: dedicated ? this.config.reverseToken : null
    };
  }
  // Read-only summary shown on the QR page: enough for a useful dashboard, and
  // deliberately free of any token, credential or filesystem path.
  overview(req) {
    const status = this.adapter.status();
    const diagnostics = this.adapter.driver.diagnostics?.() || {};
    const origin = `http://${String(req.headers.host || '127.0.0.1')}`;
    const socket = origin.replace(/^http/, 'ws');
    return {
      app_name: PROJECT_ID,
      version: VERSION,
      online: status.online === true,
      account: Number(this.adapter.driver.account) || 0,
      driver: status.driver || null,
      simulated: status.simulated === true,
      kernel_version: diagnostics.version || null,
      startup_stage: diagnostics.startup_stage || null,
      login_state: diagnostics.login_state || null,
      capabilities: Array.isArray(this.adapter.driver.capabilities) ? this.adapter.driver.capabilities.length : 0,
      clients: this.clients.size,
      // The reverse-WS token is only published when the operator gave it its own
      // value; when it still falls back to ONEBOT_ACCESS_TOKEN nothing is exposed.
      reverse: {
        ...this.reverseInfo(),
        manageable: isLoopback(req),
        links: this.links.map(link => ({ url: link.url, enable: link.enable,
          connected: this.reverse.get(link.id)?.connected === true }))
      },
      webhook: Boolean(this.config.webhookUrl),
      uptime_s: Math.floor((Date.now() - this.startedAt) / 1000),
      heartbeat_ms: this.config.heartbeatMs,
      endpoints: { http: origin, ws: `${socket}/`, api: `${socket}/api`, event: `${socket}/event` }
    };
  }
  async http(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { respond(res, 400, failure(new BotError('Invalid URL', 1400))); return; }
    const path = url.pathname.replace(/\/$/, '') || '/';
    if (await this.adapter.driver.images?.http(req, res, url)) return;
    if (path === '/healthz') { respond(res, 200, { ok: !this.closed }); return; }
    if (path === '/readyz') { respond(res, this.adapter.status().online ? 200 : 503, { ready: this.adapter.status().online }); return; }

    // The QR page carries only its own random path token, never the OneBot or
    // admin credential. It is reachable from localhost unless HOST is public.
    if (path === '/login' || path.startsWith('/login/')) {
      const token = path === '/login' ? '' : path.slice('/login/'.length).split('/')[0];
      if (this.config.qrPage && token === this.pageToken) {
        if (path === `/login/${this.pageToken}` && req.method === 'GET') {
          html(res, 200, renderLoginPage(this.pageToken, { name: PROJECT_NAME, version: VERSION })); return;
        }
        if (path === `/login/${this.pageToken}/start` && req.method === 'POST') {
          respond(res, 200, ok(await this.adapter.login('start', {}))); return;
        }
        if (path === `/login/${this.pageToken}/state` && req.method === 'GET') {
          respond(res, 200, ok(await this.adapter.login('poll', { handle: url.searchParams.get('handle') || '' }))); return;
        }
        if (path === `/login/${this.pageToken}/overview` && req.method === 'GET') {
          respond(res, 200, ok(this.overview(req))); return;
        }
        // Network settings change where the bot's traffic goes, so they stay
        // reachable from this machine only - the page token alone is not enough
        // once HOST is bound to a LAN address.
        if (path === `/login/${this.pageToken}/network`) {
          if (!isLoopback(req)) {
            respond(res, 403, failure(new BotError('网络配置只能在本机修改', 1403))); return;
          }
          if (req.method === 'GET') {
            respond(res, 200, ok({ ...this.reverseInfo(), links: this.linkState() })); return;
          }
          if (req.method === 'POST') {
            try {
              const payload = await body(req, 64 * 1024);
              respond(res, 200, ok({ ...this.reverseInfo(), links: this.applyLinks(sanitizeLinks(payload.links)) }));
            } catch (error) {
              respond(res, 400, failure(error instanceof BotError ? error : new BotError(error.message || '保存失败', 1400)));
            }
            return;
          }
          respond(res, 405, failure(new BotError('Method not allowed', 1400))); return;
        }
      }
      respond(res, 404, failure(new BotError('Login page not found', 1404))); return;
    }

    const admin = path === '/admin' || path.startsWith('/admin/');
    if (!authorize(req, url, admin ? this.config.adminToken : this.config.token, { allowQuery: !admin })) {
      respond(res, 401, failure(new BotError('Unauthorized', 1401))); return;
    }
    try {
      if (path === '/admin/status' && req.method === 'GET') {
        const origin = `http://${req.headers.host || '127.0.0.1'}`;
        respond(res, 200, { ...this.adapter.status(), account: this.adapter.driver.account,
          app_name: PROJECT_ID, version: VERSION,
          capabilities: this.adapter.driver.capabilities, login_page: this.loginUrl(origin) }); return;
      }
      if (path === '/admin/kernel/update' && req.method === 'GET') {
        try { respond(res, 200, await checkKernelUpdate({ runtimeDirectory: this.config.kernel.runtime })); }
        catch (error) { respond(res, 200, { current: null, latest: null, update_available: false, error: error.message }); }
        return;
      }
      if (path.startsWith('/admin/login/') && req.method === 'POST') {
        const params = await body(req, this.config.maxRequestBytes || MAX_BYTES);
        respond(res, 200, ok(await this.adapter.login(path.split('/').at(-1), params))); return;
      }
      if (admin) { respond(res, 404, failure(new BotError('Admin endpoint not found', 1404))); return; }
      if (!['GET', 'POST'].includes(req.method)) { respond(res, 405, failure(new BotError('Method not allowed', 1400))); return; }
      const query = Object.fromEntries(url.searchParams);
      const posted = req.method === 'POST' ? await body(req, this.config.maxRequestBytes || MAX_BYTES) : {};
      const params = { ...query, ...posted };
      delete params.access_token;
      const form = (req.headers['content-type'] || '').split(';')[0] === 'application/x-www-form-urlencoded';
      if ((!Object.hasOwn(posted, 'message') || form) && typeof params.message === 'string' && params.message.startsWith('[')) {
        try { const parsed = JSON.parse(params.message); if (Array.isArray(parsed)) params.message = parsed; } catch { /* CQ or plain text */ }
      }
      respond(res, 200, ok(await this.action(path.slice(1), params)));
    } catch (error) {
      if (admin) respond(res, error.status || 400, { status: 'failed', message: error.message });
      else respond(res, httpCode(error), failure(error));
    }
  }
  action(name, params = {}, context = {}) {
    return this.adapter.action(name, params, context);
  }
  attach(ws, events, api) {
    const client = { events, api, inFlight: 0, alive: true };
    this.clients.set(ws, client);
    ws.on('error', () => {});
    ws.on('pong', () => { client.alive = true; });
    ws.on('close', () => this.clients.delete(ws));
    ws.on('message', (data, binary) => {
      if (!api) return;
      let request;
      try {
        if (binary) throw new Error();
        request = JSON.parse(data.toString());
        if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.action !== 'string') throw new Error();
      } catch { send(ws, failure(new BotError('Invalid OneBot request', 1400))); return; }
      const echo = Object.hasOwn(request, 'echo') ? { echo: request.echo } : {};
      if (client.inFlight >= 16) { send(ws, { ...failure(new BotError('Too many in-flight requests', 1503)), ...echo }); return; }
      client.inFlight++;
      this.action(request.action, request.params).then(
        result => send(ws, { ...ok(result), ...echo }),
        error => send(ws, { ...failure(error), ...echo })
      ).finally(() => { client.inFlight--; });
    });
    if (events) send(ws, this.meta('lifecycle', { sub_type: 'connect' }));
  }
  broadcast(event) {
    for (const [ws, client] of this.clients) if (client.events) send(ws, event);
    if (this.config.webhookUrl && this.webhookPending < 256) {
      this.webhookPending++;
      this.webhookTail = this.webhookTail.then(() => this.postWebhook(event)).catch(() => {
        if (!this.closed) this.log('warn', 'webhook_delivery_failed');
      }).finally(() => { this.webhookPending--; });
    } else if (this.config.webhookUrl && this.webhookPending >= 256) this.log('warn', 'webhook_queue_full');
  }
  async postWebhook(event) {
    if (this.closed) return;
    const text = JSON.stringify(event);
    const response = await fetch(this.config.webhookUrl, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Self-ID': String(event.self_id),
        ...(this.config.webhookSecret ? { 'X-Signature': `sha1=${createHmac('sha1', this.config.webhookSecret).update(text).digest('hex')}` } : {}) },
      body: text, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(5000)]) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Webhook failed'); }
    if (response.status === 204) return;
    let raw = '';
    for await (const chunk of response.body) {
      raw += Buffer.from(chunk).toString('binary');
      if (raw.length > 65536) throw new Error('Webhook response too large');
    }
    if (!raw.trim() || event.post_type !== 'message') return;
    const quick = JSON.parse(Buffer.from(raw, 'binary').toString('utf8'));
    if (quick.reply === undefined) return;
    let reply = quick.reply;
    const defaultAt = this.adapter.driver.capabilities.includes('message.at');
    if (event.message_type === 'group' && boolean(quick.at_sender, defaultAt)) {
      const { parseMessage } = await import('./messages.mjs');
      reply = [{ type: 'at', data: { qq: String(event.user_id) } },
        ...parseMessage(reply, boolean(quick.auto_escape))];
    }
    await this.adapter.action(event.message_type === 'group' ? 'send_group_msg' : 'send_private_msg', {
      message: reply, auto_escape: boolean(quick.auto_escape), user_id: event.user_id, group_id: event.group_id
    }, { signal: this.controller.signal });
  }
  /**
   * Reverse links are a small editable list (data/network.json) instead of a
   * fixed .env value: the page can add, disable or retarget one without a
   * restart. Entries are keyed by id so a running socket keeps its identity.
   */
  syncReverse() {
    const wanted = new Set(this.links.filter(link => link.enable).map(link => link.id));
    for (const [id, entry] of this.reverse) {
      if (wanted.has(id)) continue;
      clearTimeout(entry.timer);
      entry.socket?.terminate();
      this.reverse.delete(id);
    }
    if (this.closed || !this.adapter.driver.account) return;
    for (const link of this.links) if (link.enable && !this.reverse.has(link.id)) this.connectReverse(link, 0);
  }
  connectReverse(link, attempt) {
    if (this.closed || !this.adapter.driver.account || this.reverse.has(link.id)) return;
    const entry = { socket: null, timer: null, connected: false, attempt, error: '' };
    this.reverse.set(link.id, entry);
    const ws = new WebSocket(link.url, { headers: { Authorization: `Bearer ${link.token || this.config.reverseToken}`,
      'X-Self-ID': String(this.adapter.driver.account), 'X-Client-Role': 'Universal' },
      handshakeTimeout: 10000, maxPayload: this.config.maxRequestBytes || MAX_BYTES, followRedirects: false });
    entry.socket = ws;
    ws.on('error', error => { entry.error = error.message || 'connection failed'; });
    ws.on('open', () => {
      entry.attempt = 0; entry.connected = true; entry.error = '';
      this.attach(ws, true, true);
      this.log('info', 'reverse_ws_connected', { url: link.url });
    });
    ws.on('close', () => {
      entry.connected = false;
      if (this.closed) return;
      const still = this.links.some(item => item.id === link.id && item.enable);
      if (!still) { this.reverse.delete(link.id); return; }
      const wait = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)) + Math.floor(Math.random() * 300);
      entry.timer = setTimeout(() => {
        this.reverse.delete(link.id); this.connectReverse(link, attempt + 1);
      }, wait);
    });
  }
  linkState() {
    return this.links.map(link => {
      const entry = this.reverse.get(link.id);
      return { id: link.id, enable: link.enable, url: link.url, token: link.token,
        connected: entry?.connected === true, error: entry?.error || '' };
    });
  }
  applyLinks(links) {
    writeLinks(this.config, links);
    this.links = links;
    this.syncReverse();
    return this.linkState();
  }
  async close() {
    this.closed = true; clearInterval(this.heartbeat); clearInterval(this.pingTimer); this.controller.abort();
    this.adapter.off('event', this.onEvent); this.adapter.off('outgoing', this.onOutgoing); this.adapter.off('state', this.onState);
    for (const entry of this.reverse.values()) { clearTimeout(entry.timer); entry.socket?.terminate(); }
    this.reverse.clear();
    for (const ws of this.clients.keys()) ws.terminate();
    this.wsServer.close();
    if (this.server.listening) {
      this.server.closeAllConnections();
      await new Promise(resolve => this.server.close(resolve));
    }
    await this.webhookTail;
  }
}
