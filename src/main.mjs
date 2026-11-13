import { loadConfig } from './config.mjs';
import { createApp } from './app.mjs';

const config = loadConfig(process.env);
let app;
try {
  app = await createApp(config);
} catch (error) {
  process.stderr.write(`启动失败：${error.message}\n`);
  process.exitCode = 1;
  process.exit();
}

const address = app.server.server.address();
const host = ['0.0.0.0', 'localhost', '::'].includes(config.host) ? '127.0.0.1' : config.host;
const origin = `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`;
process.stdout.write(`OneBot v11  ${origin}\n`);
process.stdout.write(`WebSocket   ${origin.replace('http://', 'ws://')}/  (universal) · /api · /event\n`);
process.stdout.write(`扫码登录    ${app.loginUrl}\n`);
if (!config.qrPage) process.stdout.write('扫码登录页已关闭；使用 POST /admin/login/start 获取二维码。\n');

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
process.on('unhandledRejection', error => {
  process.stderr.write(`未处理的异常：${error?.message || error}\n`);
});
