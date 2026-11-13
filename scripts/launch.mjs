import { parseEnv } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { loadConfig } from '../src/config.mjs';
import { prepareKernel } from '../src/qq/kernel/prepare.mjs';

const args = new Set(process.argv.slice(2));
const env = { ...(existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {}), ...process.env };
if (!existsSync('.env')) {
  process.stderr.write('没有找到 .env，请先运行 npm run init。\n');
  process.exit(1);
}
const config = loadConfig(env);

const require = createRequire(import.meta.url);
for (const name of ['ws', 'silk-wasm']) {
  try { require.resolve(name); }
  catch {
    process.stdout.write(`缺少依赖 ${name}，正在安装…\n`);
    const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (install.status !== 0) {
      process.stderr.write('依赖安装失败，请在项目目录手动运行：npm install\n');
      process.exit(1);
    }
    break;
  }
}
const { createApp } = await import('../src/app.mjs');

if (!args.has('--skip-prepare')) {
  try {
    await prepareKernel(config, { notify: message => process.stdout.write(`${message}\n`) });
  } catch (error) {
    process.stderr.write(`QQ 运行时准备失败：\n${error.message}\n`);
    process.exit(1);
  }
}

const app = await createApp(config);
const address = app.server.server.address();
const host = ['0.0.0.0', 'localhost', '::'].includes(config.host) ? '127.0.0.1' : config.host;
const origin = `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`;
process.stdout.write(`OneBot v11  ${origin}\n`);
process.stdout.write(`WebSocket   ${origin.replace('http://', 'ws://')}/  (universal) · /api · /event\n`);
process.stdout.write(`扫码登录    ${app.loginUrl}\n`);

if (!args.has('--no-open') && process.platform === 'win32') {
  try { spawn('cmd', ['/c', 'start', '', app.loginUrl], { stdio: 'ignore' }); } catch {}
}

let stopping = false;
const stop = async signal => {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`收到 ${signal}，正在退出…\n`);
  try { await app.close(); process.exit(0); }
  catch (error) { process.stderr.write(`退出时出错：${error.message}\n`); process.exit(1); }
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
