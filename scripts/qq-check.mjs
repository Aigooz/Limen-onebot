import { parseEnv } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { verifyKernel } from '../src/qq/kernel-driver.mjs';

if (!existsSync('.env')) {
  process.stderr.write('没有找到 .env，请先运行 npm run init。\n');
  process.exit(1);
}
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const config = loadConfig(env);
try {
  const metadata = await verifyKernel(config);
  process.stdout.write(JSON.stringify({
    ok: true, version: metadata.version, sdk_app_id: metadata.sdk_app_id,
    runtime_root: metadata.runtime_root, app_path: metadata.app_path,
    adapter_sha256: metadata.adapted_kernel_sha256, bridge_sha256: metadata.bridge_sha256
  }, null, 2) + '\n');
} catch (error) {
  process.stderr.write(`校验失败：${error.message}\n运行 npm run qq:build 重建桥接，或 npm run qq:prepare 重新准备运行时。\n`);
  process.exit(1);
}
