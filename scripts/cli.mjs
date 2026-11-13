import { parseEnv } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';

const env = { ...(existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {}), ...process.env };
const host = ['0.0.0.0', 'localhost', '::'].includes(env.HOST) || !env.HOST ? '127.0.0.1' : env.HOST;
const base = `http://${host.includes(':') ? `[${host}]` : host}:${env.PORT || 5700}`;
const token = env.ONEBOT_ACCESS_TOKEN || '';
const admin = env.ADMIN_ACCESS_TOKEN || '';
const [command, ...rest] = process.argv.slice(2);

async function call(action, params = {}) {
  const response = await fetch(`${base}/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const value = await response.json();
  if (value.status !== 'ok') throw new Error(value.message || `retcode ${value.retcode}`);
  return value.data;
}
async function get(path, useAdmin = false) {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${useAdmin ? admin : token}` } });
  const value = await response.json();
  if (value.status !== 'ok') throw new Error(value.message || `retcode ${value.retcode}`);
  return value.data;
}

try {
  if (command === 'status') {
    const status = await get('/admin/status', true);
    process.stdout.write(JSON.stringify(status, null, 2) + '\n');
  } else if (command === 'friends') {
    const friends = await call('get_friend_list');
    for (const friend of friends) process.stdout.write(`${friend.user_id}\t${friend.nickname || ''}${friend.remark ? `\t(${friend.remark})` : ''}\n`);
    process.stdout.write(`共 ${friends.length} 个好友\n`);
  } else if (command === 'groups') {
    const groups = await call('get_group_list');
    for (const group of groups) process.stdout.write(`${group.group_id}\t${group.group_name || ''}\t${group.member_count ?? '?'} 人\n`);
    process.stdout.write(`共 ${groups.length} 个群\n`);
  } else if (command === 'send' && rest.length >= 2) {
    process.stdout.write(JSON.stringify(await call('send_private_msg', { user_id: Number(rest[0]), message: rest.slice(1).join(' ') })) + '\n');
  } else if (command === 'send-group' && rest.length >= 2) {
    process.stdout.write(JSON.stringify(await call('send_group_msg', { group_id: Number(rest[0]), message: rest.slice(1).join(' ') })) + '\n');
  } else if (command === 'watch') {
    const seconds = Math.max(1, Number(rest[0]) || 60);
    const WebSocket = (await import('ws')).default;
    const socket = new WebSocket(`${base.replace('http://', 'ws://')}/event`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    socket.on('message', data => process.stdout.write(`${data.toString()}\n`));
    socket.on('error', error => { process.stderr.write(`WebSocket 错误：${error.message}\n`); process.exit(1); });
    process.stdout.write(`监听事件 ${seconds} 秒…\n`);
    setTimeout(() => { socket.close(); process.exit(0); }, seconds * 1000);
  } else {
    process.stdout.write(`用法：
  npm run cli -- status
  npm run cli -- friends
  npm run cli -- groups
  npm run cli -- send <QQ号> <文本>
  npm run cli -- send-group <群号> <文本>
  npm run cli -- watch [秒]\n`);
    process.exit(command ? 1 : 0);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
