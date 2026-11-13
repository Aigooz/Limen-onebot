import { join } from 'node:path';
import { lockData } from './data-lock.mjs';
import { Store } from './store.mjs';
import { MessageIdMap } from './qq/message-ids.mjs';
import { loadDriver } from './qq/driver.mjs';
import { QQAdapter } from './qq/adapter.mjs';
import { OneBotServer } from './onebot.mjs';
import { createLogger } from './logger.mjs';
import { describeDriverFault } from './qq/faults.mjs';

export async function createApp(config, overrides = {}) {
  const log = overrides.log || createLogger();
  const unlock = lockData(config.dataDir);
  let store, adapter, server;
  try {
    store = new Store(join(config.dataDir, 'bot.sqlite'));
    const ids = new MessageIdMap(store.db);
    const driver = overrides.driver || await loadDriver(config, log, ids);
    adapter = new QQAdapter(driver, config);
    adapter.on('event', event => {
      try { log('info', 'onebot_event', { state: event.post_type, message_type: event.message_type,
        notice_type: event.notice_type, request_type: event.request_type }); } catch {}
    });
    adapter.on('state', () => log('info', 'qq_connection_changed', { state: adapter.status().online ? 'online' : 'offline' }));
    adapter.on('fault', error => log('warn', 'qq_driver_fault', describeDriverFault(error)));
    server = new OneBotServer({ adapter, config, log, store });
    await adapter.start();
    await server.start();
    const cleanup = setInterval(() => {
      try { store.cleanup(); } catch { log('error', 'storage_cleanup_failed'); }
    }, 3600000);
    let closing;
    return {
      config, adapter, store, server, log,
      address: server.server.address(),
      get loginUrl() {
        const address = server.server.address();
        const host = ['0.0.0.0', 'localhost', '::'].includes(config.host) ? '127.0.0.1' : config.host;
        return `http://${host.includes(':') ? `[${host}]` : host}:${address.port}/login/${server.pageToken}`;
      },
      close() {
        if (!closing) closing = (async () => {
          clearInterval(cleanup);
          try {
            await server.close();
            await adapter.close();
          } finally { store.close(); unlock(); }
        })();
        return closing;
      }
    };
  } catch (error) {
    await server?.close().catch(() => {});
    await adapter?.close().catch(() => {});
    store?.close(); unlock(); throw error;
  }
}
