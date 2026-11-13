import { parseEnv } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { prepareKernel } from '../src/qq/kernel/prepare.mjs';

if (!existsSync('.env')) {
  process.stderr.write('没有找到 .env，请先运行 npm run init。\n');
  process.exit(1);
}
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const config = loadConfig(env);
const from = process.argv.find(value => value.startsWith('--from='))?.slice('--from='.length)
  || (process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : '');
try {
  const result = await prepareKernel(config, { source: from, notify: message => process.stdout.write(`${message}\n`) });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
