import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const file = resolve('.env');
if (existsSync(file)) {
  process.stdout.write('.env 已存在，保留现有配置。删除后再运行 init 会重新生成凭据。\n');
  process.exit(0);
}
const token = randomBytes(24).toString('base64url');
const admin = randomBytes(24).toString('base64url');
const reverse = randomBytes(24).toString('base64url');
const secret = randomBytes(32).toString('hex');
let template = readFileSync(resolve('.env.example'), 'utf8');
for (const [key, value] of [['ONEBOT_ACCESS_TOKEN', token], ['ADMIN_ACCESS_TOKEN', admin],
  ['REVERSE_WS_TOKEN', reverse], ['MEDIA_SECRET', secret]]) {
  template = template.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
}

// Reuse an existing Limen workspace runtime when one is present: the QQ files
// are read-only inputs, while the bridge is rebuilt into this project's own
// kernel directory so the other installation keeps working.
const candidate = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'limen', 'workspace', 'runtime', 'qq');
if (existsSync(join(candidate, 'runtime.json'))) {
  template = template.replace(/^QQ_RUNTIME_DIR=.*$/m, `QQ_RUNTIME_DIR=${candidate.replaceAll('\\', '/')}`);
  process.stdout.write(`检测到已有 QQ 运行时，已写入 QQ_RUNTIME_DIR：\n  ${candidate}\n`);
  process.stdout.write('桥接会重新构建到本项目自己的 runtime/kernel，不会改动原工作区。\n');
}
writeFileSync(file, template, { mode: 0o600 });
process.stdout.write('已生成 .env：\n');
process.stdout.write(`  ONEBOT_ACCESS_TOKEN=${token}\n  ADMIN_ACCESS_TOKEN=${admin}\n  REVERSE_WS_TOKEN=${reverse}\n`);
process.stdout.write('凭据只写入本机 .env；请勿提交或公开。下一步：npm run launch\n');
