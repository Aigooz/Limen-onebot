import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { MessageIdMap } from '../src/qq/message-ids.mjs';
import { QQAdapter } from '../src/qq/adapter.mjs';
import { OneBotServer } from '../src/onebot.mjs';
import { QQDriver } from '../src/qq/driver.mjs';
import { createLogger } from '../src/logger.mjs';
import { validateKernelMessage } from '../src/qq/kernel/elements.mjs';
import { createKernelActions } from '../src/qq/kernel/actions.mjs';
import { ImageCache } from '../src/qq/kernel/image.mjs';
import { BotError } from '../src/errors.mjs';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class FakeDriver extends QQDriver {
  constructor() { super({ account: 0 }); this.calls = []; this.images = null; }
  get mode() { return 'demo'; }
  get capabilities() { return ['account.get', 'friend.list', 'group.list', 'user.get', 'group.get', 'group.members',
    'group.member', 'message.send', 'message.get', 'message.delete', 'message.history', 'message.read',
    'image.get', 'media.image', 'media.record', 'media.file', 'send_poke', 'send_like', 'group.kick', 'group.ban',
    'group.whole_ban', 'group.admin', 'group.card', 'group.rename', 'group.leave', 'group.remark', 'group.title',
    'group.files', 'group.file.delete', 'group.file.space', 'group.notices', 'group.notice.send', 'group.notice.delete',
    'group.honor', 'group.shut_list', 'group.at_all_remain', 'group.essence.list', 'group.essence.add',
    'group.essence.remove', 'friend.requests', 'friend.request', 'friend.delete', 'friend.remark', 'group.requests',
    'group.request', 'recent.list', 'profile.set', 'profile.set_avatar']; }
  async connect() { this.account = 10000; this.online = true; this.emit('state', { online: true, account: 10000 }); }
  async close() { this.online = false; }
  async invoke(command, params) {
    this.calls.push({ command, params });
    switch (command) {
      case 'account.get': return { user_id: 10000, nickname: '测试机器人' };
      case 'friend.list': return [{ user_id: 10001, nickname: '好友甲', remark: '' }];
      case 'group.list': return [{ group_id: 20001, group_name: '测试群', member_count: 3, max_member_count: 200 }];
      case 'group.members': return [{ group_id: 20001, user_id: 10001, nickname: '好友甲', card: '', role: 'member',
        join_time: 1, last_sent_time: 2, level: '1', sex: 'unknown', age: 0, area: '', unfriendly: false,
        title: '', title_expire_time: 0, card_changeable: true }];
      case 'message.send': return { message_id: 42 };
      case 'message.get': return { message_id: 42, message_type: 'group', group_id: 20001,
        sender: { user_id: 10001, nickname: '好友甲' }, time: 1, message: [{ type: 'text', data: { text: 'hi' } }],
        raw_message: 'hi' };
      default: return null;
    }
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'limen-self-test-'));
const config = {
  host: '127.0.0.1', port: 0, dataDir, token: 't'.repeat(32), adminToken: 'a'.repeat(32),
  reverseToken: 't'.repeat(32), heartbeatMs: 60_000, reverseUrls: [], webhookUrl: '', webhookSecret: '',
  maxRequestBytes: 1024 * 1024, qrPage: true, kernel: { runtime: '.' }, media: { maxBytes: 1024 * 1024, timeout: 5000 }
};
const store = new Store(':memory:');
new MessageIdMap(store.db);
const driver = new FakeDriver();
const adapter = new QQAdapter(driver, config);
const log = createLogger(() => {});
const server = new OneBotServer({ adapter, config, log, store });
const avatarSource = join(dataDir, 'avatar-source.png');
await adapter.start();
await server.start();
const address = server.server.address();
const base = `http://127.0.0.1:${address.port}`;
const auth = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
const admin = { Authorization: `Bearer ${config.adminToken}`, 'Content-Type': 'application/json' };
const call = async (action, params = {}, headers = auth) => {
  const response = await fetch(`${base}/${action}`, { method: 'POST', headers, body: JSON.stringify(params) });
  return response.json();
};

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; process.stdout.write(`ok  ${name}\n`); };

try {
  await check('healthz', async () => {
    const response = await fetch(`${base}/healthz`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  });
  await check('rejects missing token', async () => {
    const response = await fetch(`${base}/get_version_info`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 401);
  });
  await check('version + login info', async () => {
    const version = await call('get_version_info');
    assert.equal(version.data.protocol_version, 'v11');
    const login = await call('get_login_info');
    assert.equal(login.data.user_id, 10000);
  });
  await check('group member list', async () => {
    const result = await call('get_group_member_list', { group_id: 20001 });
    assert.equal(result.status, 'ok');
    assert.equal(result.data[0].role, 'member');
    assert.equal(driver.calls.at(-1).command, 'group.members');
  });
  await check('stranger info', async () => {
    const result = await call('get_stranger_info', { user_id: 10001 });
    assert.equal(result.status, 'ok');
    assert.equal(driver.calls.at(-1).command, 'user.get');
  });
  await check('QQ profile and avatar actions use the kernel commands', async () => {
    const profile = await call('set_qq_profile', { nickname: '测试昵称', personal_note: '测试签名' });
    assert.equal(profile.status, 'ok');
    assert.deepEqual(driver.calls.at(-1), {
      command: 'profile.set',
      params: { nickname: '测试昵称', signature: '测试签名', sex: undefined },
    });
    const avatar = await call('set_qq_avatar', { file: 'https://example.invalid/avatar.png' });
    assert.equal(avatar.status, 'ok');
    assert.deepEqual(driver.calls.at(-1), {
      command: 'profile.set_avatar',
      params: { file: 'https://example.invalid/avatar.png' },
    });
  });
  await check('kernel profile uses the desktop update path and preserves unmodified fields', async () => {
    const calls = [];
    const profileService = {
      getUserDetailInfo: async () => ({ longNick: '旧签名', sex: 2 }),
      modifyDesktopMiniProfile: async payload => { calls.push(payload); return { result: 0 }; },
      modifySelfProfile: async () => { throw new Error('legacy fallback should not run'); },
    };
    const actions = createKernelActions({
      session: () => ({ getProfileService: () => profileService }),
      msgService: () => null,
      self: () => ({ uin: '10000', uid: 'u_self' }),
      emit: () => {},
      uidToUin: () => 0,
    });
    await actions['profile.set']({ nickname: '测试昵称' });
    assert.deepEqual(calls, [{ nick: '测试昵称', longNick: '旧签名', sex: 2 }]);
  });
  await check('kernel avatar passes a validated local path to setHeader and releases it', async () => {
    writeFileSync(avatarSource, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQImWNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=', 'base64'));
    const cache = new ImageCache(join(dataDir, 'avatar-cache'), { maxBytes: 1024 * 1024 });
    let headerPath = '';
    const actions = createKernelActions({
      session: () => ({ getProfileService: () => ({
        setHeader: async path => { headerPath = path; return { result: 0 }; },
      }) }),
      msgService: () => null,
      self: () => ({ uin: '10000', uid: 'u_self' }),
      emit: () => {},
      uidToUin: () => 0,
    }, undefined, { imageCache: cache, maxFileBytes: 1024 * 1024 });
    await actions['profile.set_avatar']({ file: avatarSource });
    assert.equal(headerPath, join(dataDir, 'avatar-cache', '979029bccb1ddb562ad41da8021235bc.png'));
    assert.ok(existsSync(headerPath));
    assert.equal(cache.active.size, 0);
    assert.match(String(actions['profile.set_avatar']), /setHeader\(image\.path\)/);
    assert.doesNotMatch(String(actions['profile.set_avatar']), /setHeader\(prepared\.elements/);
  });
  await check('kernel avatar reports an uncertain timeout without claiming failure', async () => {
    const controller = new AbortController();
    const cache = new ImageCache(join(dataDir, 'avatar-timeout-cache'), { maxBytes: 1024 * 1024 });
    const actions = createKernelActions({
      session: () => ({ getProfileService: () => ({
        setHeader: async () => {
          controller.abort();
          throw new Error('native stalled');
        },
      }) }),
      msgService: () => null,
      self: () => ({ uin: '10000', uid: 'u_self' }),
      emit: () => {},
      uidToUin: () => 0,
    }, undefined, { imageCache: cache, maxFileBytes: 1024 * 1024 });
    await assert.rejects(actions['profile.set_avatar']({ file: avatarSource, signal: controller.signal }), error => {
      assert.equal(error.code, 1502);
      assert.equal(error.uncertain, true);
      assert.equal(error.retryable, false);
      assert.match(error.message, /result is unknown/);
      return true;
    });
    assert.equal(cache.active.size, 0);
  });
  await check('send group text with CQ at', async () => {
    const result = await call('send_group_msg', { group_id: 20001, message: '[CQ:at,qq=10001] 你好' });
    assert.equal(result.data.message_id, 42);
    const callRecord = driver.calls.at(-1);
    assert.equal(callRecord.command, 'message.send');
    assert.equal(callRecord.params.message[0].type, 'at');
    assert.equal(callRecord.params.message[1].data.text, ' 你好');
  });
  await check('delete message', async () => {
    const result = await call('delete_msg', { message_id: 42 });
    assert.equal(result.status, 'ok');
    assert.equal(driver.calls.at(-1).command, 'message.delete');
  });
  await check('group ban', async () => {
    const result = await call('set_group_ban', { group_id: 20001, user_id: 10001, duration: 600 });
    assert.equal(result.status, 'ok');
    const record = driver.calls.at(-1);
    assert.equal(record.command, 'group.ban');
    assert.equal(record.params.duration, 600);
  });
  await check('invalid id is rejected', async () => {
    const result = await call('get_group_info', { group_id: 'abc' });
    assert.equal(result.status, 'failed');
    assert.equal(result.retcode, 1400);
  });
  await check('file segment is validated', async () => {
    assert.throws(() => validateKernelMessage([{ type: 'file', data: { file: 'C:/tmp/x.txt' } }, { type: 'text', data: { text: 'x' } }]),
      BotError);
    validateKernelMessage([{ type: 'file', data: { file: 'C:/tmp/x.txt' } }]);
  });
  await check('admin status exposes capabilities', async () => {
    const response = await fetch(`${base}/admin/status`, { headers: admin });
    const value = await response.json();
    assert.equal(value.account, 10000);
    assert.ok(value.capabilities.includes('group.kick'));
  });
  await check('login page uses a path token, not the admin token', async () => {
    const response = await fetch(`${base}/login/${server.pageToken}`);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(text.includes('Limen OneBot'));
    assert.ok(!text.includes(config.adminToken));
    assert.ok(!text.includes(config.token));
  });
  await check('login page overview exposes read-only status only', async () => {
    const denied = await fetch(`${base}/login/not-the-page-token/overview`);
    assert.equal(denied.status, 404);
    const response = await fetch(`${base}/login/${server.pageToken}/overview`);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(!text.includes(config.adminToken));
    assert.ok(!text.includes(config.token));
    const value = JSON.parse(text);
    assert.equal(value.status, 'ok');
    assert.equal(value.data.account, 10000);
    assert.equal(typeof value.data.uptime_s, 'number');
    assert.equal(value.data.endpoints.http.startsWith('http://'), true);
    assert.equal(value.data.reverse.shared, true);
    assert.equal(value.data.reverse.token, null);
  });
  await check('overview publishes a dedicated reverse WS token', async () => {
    const saved = config.reverseToken;
    config.reverseToken = 'r'.repeat(32);
    try {
      const response = await fetch(`${base}/login/${server.pageToken}/overview`);
      const text = await response.text();
      const value = JSON.parse(text);
      assert.equal(value.data.reverse.shared, false);
      assert.equal(value.data.reverse.token, 'r'.repeat(32));
      assert.ok(!text.includes(config.token));
      assert.ok(!text.includes(config.adminToken));
    } finally { config.reverseToken = saved; }
  });
  await check('network config lists, saves and applies reverse links', async () => {
    const empty = await (await fetch(`${base}/login/${server.pageToken}/network`)).json();
    assert.equal(empty.status, 'ok');
    assert.deepEqual(empty.data.links, []);
    const payload = { links: [{ url: 'ws://127.0.0.1:65001/ws', enable: false, token: 'k'.repeat(16) }] };
    const saved = await (await fetch(`${base}/login/${server.pageToken}/network`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).json();
    assert.equal(saved.status, 'ok');
    assert.equal(saved.data.links.length, 1);
    assert.equal(saved.data.links[0].url, 'ws://127.0.0.1:65001/ws');
    assert.equal(saved.data.links[0].enable, false);
    assert.equal(saved.data.links[0].connected, false);
    assert.ok(existsSync(join(dataDir, 'network.json')));
    const again = await (await fetch(`${base}/login/${server.pageToken}/network`)).json();
    assert.equal(again.data.links.length, 1);
    const bad = await fetch(`${base}/login/${server.pageToken}/network`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links: [{ url: 'http://example.com/x' }] }) });
    assert.equal(bad.status, 400);
    const state = await (await fetch(`${base}/login/${server.pageToken}/overview`)).json();
    assert.equal(state.data.reverse.links.length, 1);
    assert.equal(state.data.reverse.manageable, true);
  });
  await check('websocket api + event broadcast', async () => {
    const WebSocket = (await import('ws')).default;
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/`, { headers: { Authorization: `Bearer ${config.token}` } });
    const messages = [];
    socket.on('message', data => messages.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(JSON.stringify({ action: 'get_status', params: {}, echo: 'e1' }));
    await new Promise(resolve => setTimeout(resolve, 150));
    const reply = messages.find(message => message.echo === 'e1');
    assert.equal(reply.status, 'ok');
    driver.emit('notice', { notice_type: 'group_recall', group_id: 20001, user_id: 10001, operator_id: 10001, message_id: 42 });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(messages.some(message => message.post_type === 'notice' && message.notice_type === 'group_recall'));
    socket.close();
  });

  await server.close();
  await adapter.close();
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
  process.stdout.write(`\n${passed} 项自测通过（仅覆盖 OneBot 协议层，不代表 QQ 内核实机验收）。\n`);
} catch (error) {
  await server.close().catch(() => {});
  await adapter.close().catch(() => {});
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
  process.stderr.write(`自测失败：${error.stack || error.message}\n`);
  process.exit(1);
}
