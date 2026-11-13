const num = value => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};
const KEY_GROUPS = ['groupCode', 'group_code', 'groupUin', 'peerUid', 'peerUin', 'group_id'];
const KEY_USERS = ['memberUin', 'member_uin', 'userUin', 'user_uin', 'targetUin', 'target_uin',
  'invitorUin', 'invitor_uin', 'operatorUin', 'operator_uin', 'uin', 'user_id'];
const KEY_TIME = ['time', 'notifyTime', 'msgTime', 'timestamp'];
const KEY_TEXT = ['content', 'msg', 'message', 'text', 'summary'];

/** Breadth-first search for the first scalar value under one of the keys. */
function pick(value, keys, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return undefined;
  seen.add(value);
  for (const key of keys) {
    const found = value[key];
    if (['string', 'number'].includes(typeof found) && String(found).length) return found;
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = pick(child, keys, depth + 1, seen);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
function allObjects(value, depth = 0, out = []) {
  if (!value || typeof value !== 'object' || depth > 4 || out.length >= 200) return out;
  if (Array.isArray(value)) { for (const child of value) allObjects(child, depth + 1, out); return out; }
  out.push(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') allObjects(child, depth + 1, out);
  return out;
}
const stamp = args => num(pick(args, KEY_TIME)) || Math.floor(Date.now() / 1000);

/**
 * Kernel listeners are not documented. Rather than inventing payload shapes,
 * every handler extracts the fields it needs from whatever the SDK provides
 * and only publishes an event when the required identities are present.
 */
export function createKernelEvents(context, flags, log = () => {}) {
  const account = () => num(context.self()?.uin);
  const publish = (kind, fields) => {
    if (!fields || typeof fields !== 'object') return;
    context.emit(kind, fields);
  };

  function recall(args) {
    const messageId = pick(args, ['msgId', 'msg_id', 'messageId', 'message_id']);
    const peerUid = pick(args, ['peerUid', 'peer_uin', 'peerUin']);
    const chatType = num(pick(args, ['chatType', 'chat_type'])) || (String(peerUid || '').match(/^\d+$/) ? 2 : 1);
    if (!messageId || !peerUid) return;
    const operator = num(pick(args, ['operatorUin', 'operator_uin', 'adminUin', 'admin_uin']));
    // The host has no OneBot ID space; the parent driver resolves the native key
    // to a stable int32 and fills user_id from its retained message cache.
    publish('notice', { post_type: 'notice',
      notice_type: chatType === 2 ? 'group_recall' : 'friend_recall',
      ...(chatType === 2 ? { group_id: num(peerUid) } : {}),
      operator_id: operator,
      native_message: { chatType, peerUid: String(peerUid), msgId: String(messageId) } });
  }

  function nudge(raw, cached) {
    const elements = Array.isArray(raw?.elements) ? raw.elements : [];
    const marker = elements.find(element => element?.nudgeElement || element?.grayTipElement || Number(element?.elementType) === 8);
    if (!marker) return false;
    const text = JSON.stringify(marker);
    if (!/poke|nudge|戳一戳|拍了拍/i.test(text)) return false;
    const sender = num(raw?.senderUin) || num(cached?.sender?.user_id);
    const target = num(pick(marker, ['targetUin', 'target_uin', 'touid', 'toUin'])) ||
      num((text.match(/(?:touid|targetUin|toUin)\\?"?\s*[:=]\s*\\?"?(\d+)/) || [])[1]);
    const group = Number(raw?.chatType) === 2 ? num(raw?.peerUid) || num(cached?.group_id) : undefined;
    if (!sender) return false;
    publish('notice', { post_type: 'notice', notice_type: 'notify', sub_type: 'poke',
      ...(group ? { group_id: group } : {}), user_id: sender, target_id: target || sender,
      raw_info: group ? [{ type: 'qq', qq: String(sender) }] : [] });
    return true;
  }

  const seenRequests = new Set();
  function groupRequest(args) {
    for (const notify of allObjects(args)) {
      const groupId = num(pick(notify, KEY_GROUPS));
      const userId = num(pick(notify, KEY_USERS));
      if (!groupId || !userId) continue;
      const type = Number(notify.notifyType ?? notify.type);
      const identity = `${groupId}:${userId}:${notify.seq ?? notify.notifySeq ?? ''}:${type}`;
      if (seenRequests.has(identity)) continue;
      seenRequests.add(identity);
      if (seenRequests.size > 500) seenRequests.delete(seenRequests.values().next().value);
      const invited = type === 2 || type === 8;
      const comment = String(pick(notify, KEY_TEXT) || '');
      const flag = flags.put('group', notify);
      publish('request', { post_type: 'request', request_type: 'group',
        sub_type: invited ? 'invite' : 'add', group_id: groupId, user_id: userId,
        comment, flag, time: num(pick(notify, KEY_TIME)) || Math.floor(Date.now() / 1000) });
    }
  }

  function buddyRequest(args) {
    for (const request of allObjects(args)) {
      const userId = num(pick(request, ['uin', 'friendUin', 'user_id']));
      if (!userId) continue;
      const flag = flags.put('friend', request);
      publish('request', { post_type: 'request', request_type: 'friend', user_id: userId,
        comment: String(pick(request, KEY_TEXT) || ''), flag,
        time: num(pick(request, KEY_TIME)) || Math.floor(Date.now() / 1000) });
    }
  }

  function roleChanged(args) {
    const groupId = num(pick(args, KEY_GROUPS));
    const userId = num(pick(args, KEY_USERS));
    if (!groupId || !userId) return;
    const raw = num(pick(args, ['role', 'memberRole', 'newRole'])) || 0;
    const admin = raw === 1 || raw === 3 || pick(args, ['isAdmin', 'is_admin']) === true;
    publish('notice', { post_type: 'notice', notice_type: 'group_admin',
      sub_type: admin ? 'set' : 'unset', group_id: groupId, user_id: userId, time: stamp(args) });
  }

  function shutUpChanged(args) {
    const groupId = num(pick(args, KEY_GROUPS));
    if (!groupId) return;
    for (const member of allObjects(args)) {
      const userId = num(pick(member, ['memberUin', 'uin', 'user_id']));
      if (!userId) continue;
      const duration = num(member.shutUpTime ?? member.shut_up_time ?? member.duration);
      publish('notice', { post_type: 'notice', notice_type: 'group_ban',
        sub_type: duration > 0 ? 'ban' : 'lift_ban', group_id: groupId, user_id: userId,
        operator_id: num(pick(member, ['operatorUin', 'adminUin'])) || 0,
        duration, time: stamp(args) });
    }
  }

  function joinGroup(args) {
    const groupId = num(pick(args, KEY_GROUPS));
    const userId = num(pick(args, KEY_USERS));
    if (!groupId || !userId) return;
    if (userId === account()) {
      publish('notice', { post_type: 'notice', notice_type: 'group_increase', sub_type: 'approve',
        group_id: groupId, user_id: userId, operator_id: 0, time: stamp(args) });
    } else {
      publish('notice', { post_type: 'notice', notice_type: 'group_increase', sub_type: 'invite',
        group_id: groupId, user_id: userId, operator_id: num(pick(args, ['invitorUin', 'operatorUin'])) || 0,
        time: stamp(args) });
    }
  }

  function groupFile(args) {
    const groupId = num(pick(args, KEY_GROUPS));
    const userId = num(pick(args, ['uploaderUin', 'uploader', 'uin']));
    if (!groupId) return;
    const file = pick(args, ['fileName', 'name']) ? allObjects(args).find(item => item.fileName || item.name) : null;
    publish('notice', { post_type: 'notice', notice_type: 'group_upload', group_id: groupId, user_id: userId,
      file: { id: String(file?.fileId ?? file?.fileUuid ?? ''), name: String(file?.fileName ?? file?.name ?? ''),
        size: num(file?.fileSize ?? file?.size), busid: num(file?.busId) }, time: stamp(args) });
  }

  return {
    onMsgRecall: recall,
    onGroupSingleScreenNotifiesV2: groupRequest,
    onGroupSingleScreenNotifies: groupRequest,
    onGroupNotifiesUpdatedV2: groupRequest,
    onGroupNotifiesUpdated: groupRequest,
    onBuddyReqChange: buddyRequest,
    onBuddyRequest: buddyRequest,
    onGroupMemberRoleChanged: roleChanged,
    onMemberRoleChange: roleChanged,
    onShutUpMemberListChanged: shutUpChanged,
    onJoinGroupNotify: joinGroup,
    onGroupFileInfoAdd: groupFile,
    // Message-time parser for poke notices; called from the message pipeline.
    inspectMessage: nudge
  };
}
