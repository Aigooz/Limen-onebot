import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { BotError } from '../errors.mjs';

/**
 * QQ core boundary. Drivers emit message(normalized), notice(OneBot fields),
 * request(OneBot fields), state({online, account}) and fault(error).
 */
export class QQDriver extends EventEmitter {
  constructor({ account = 0 } = {}) { super(); this.account = account; this.online = false; }
  get mode() { return 'native'; }
  get capabilities() { return []; }
  async connect() {}
  async close() { this.online = false; }
  async invoke(_command, _params, _context) {
    throw new BotError('QQ protocol driver is not implemented', 1501);
  }
}

export async function loadDriver(config, log, ids) {
  if (config.driver === 'kernel') {
    const { KernelDriver } = await import('./kernel-driver.mjs');
    return new KernelDriver({ config, ids });
  }
  // A local driver module is a trusted extension point for experiments that
  // must not touch the kernel adapter (for example a mock during development).
  if (typeof config.driver === 'string' && /[\\/]/.test(config.driver)) {
    const module = await import(pathToFileURL(resolve(config.driver)).href);
    if (typeof module.createDriver !== 'function') throw new Error('QQ_DRIVER module must export createDriver');
    const driver = await module.createDriver({ account: config.account, log, ids, config });
    if (!(driver instanceof QQDriver)) throw new Error('Custom driver must extend QQDriver');
    return driver;
  }
  throw new Error(`Unknown QQ driver: ${config.driver}`);
}
