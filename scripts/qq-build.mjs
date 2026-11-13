import { parseEnv } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { buildKernel } from '../src/qq/kernel/build.mjs';

if (!existsSync('.env')) {
  process.stderr.write('没有找到 .env，请先运行 npm run init。\n');
  process.exit(1);
}
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const config = loadConfig(env);
try {
  const result = await buildKernel({ runtimeDirectory: config.kernel.runtime, directory: config.kernel.directory });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  process.stderr.write(`构建失败：${error.message}\n`);
  process.exit(1);
}
