import { BotError, deadline } from '../../errors.mjs';
import { abortable } from './lifecycle.mjs';

function profileRecord(value, uid, requireIdentity = false) {
  const record = value?.userDetailInfo ?? value?.detailInfo ?? value?.info ?? value;
  if (!record || typeof record !== 'object') return null;
  const identity = record.uid ?? record.simpleInfo?.coreInfo?.uid;
  if ((requireIdentity && identity !== uid) || (identity && identity !== uid)) return null;
  const detail = { ...record.commonExt, ...record.simpleInfo?.baseInfo, ...record.simpleInfo?.coreInfo, ...record };
  return ['nick', 'longNick', 'sex', 'birthday', 'birthday_year'].some(key => detail[key] !== undefined) ? detail : null;
}

export async function readKernelProfile(service, uid, { callbacks, signal, timeout = 5000, accept = () => true } = {}) {
  if (!uid) throw new BotError('QQ self profile identity is unavailable', 1501);
  signal?.throwIfAborted();
  if (typeof service.getUserDetailInfo === 'function') {
    try {
      const direct = await deadline(op => abortable(() => service.getUserDetailInfo(uid), op), timeout, { signal });
      const detail = profileRecord(direct, uid);
      if (detail && accept(detail) && (direct?.result === undefined || Number(direct.result) === 0)) return detail;
    } catch { signal?.throwIfAborted(); }
  }
  if (!callbacks || typeof service.fetchUserDetailInfo !== 'function') {
    throw new BotError('QQ self profile query is unavailable', 1501);
  }
  for (const source of [0, 1]) {
    try {
      return await deadline(async op => {
        let receive;
        const pushed = new Promise(resolve => {
          receive = (...values) => {
            for (const value of values) {
              const detail = profileRecord(value, uid, true);
              if (detail && accept(detail)) { resolve(detail); break; }
            }
          };
        });
        callbacks.on('profile-detail', receive);
        try {
          const result = await abortable(() => service.fetchUserDetailInfo('BuddyProfileStore', [uid], source, [0]), op);
          if (result?.result !== undefined && Number(result.result) !== 0) throw new BotError('QQ profile query rejected', 1500);
          const direct = profileRecord(result, uid);
          return direct && accept(direct) ? direct : await abortable(() => pushed, op);
        } finally { callbacks.off('profile-detail', receive); }
      }, timeout, { signal });
    } catch { signal?.throwIfAborted(); }
  }
  throw new BotError('QQ self profile query did not return complete data', 1501);
}

export function buddyListArity(bytes) {
  const values = new Set([...bytes.toString('latin1').matchAll(/NodeIKernelBuddyService::getBuddyListV2 needs (\d+) arguments/g)].map(match => Number(match[1])));
  if (values.size !== 1 || ![2, 3].includes([...values][0])) throw new BotError('Unsupported QQ buddy list API signature', 1501);
  return [...values][0];
}

// This is the SDK sub-application ID embedded in this exact signed QQ build,
// distinct from the public desktop platform application ID.
export function sdkAppId(binary) {
  const marker = Buffer.from('QQAppId/');
  const values = new Set(); let offset = 0;
  while ((offset = binary.indexOf(marker, offset)) !== -1) {
    const value = binary.subarray(offset + marker.length, offset + marker.length + 20).toString('ascii').match(/^(\d{6,12})(?!\d)/)?.[1];
    if (value) values.add(value); offset += marker.length;
  }
  if (values.size !== 1) throw new BotError('Official QQ package has no unique SDK application ID', 1501);
  return [...values][0];
}

export function loginOptions({ appid, version, directory, machineId, platformVersion, hostName }) {
  if (!/^\d{6,12}$/.test(appid || '') || !/^\d+\.\d+\.\d+-\d+$/.test(version || '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(machineId || '')) {
    throw new BotError('QQ login profile is incomplete', 1501);
  }
  return { commonPath: directory, clientVer: version, machineId, platVer: platformVersion, hostName, appid, externalVersion: true };
}
