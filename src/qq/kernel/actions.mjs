import { randomBytes } from 'node:crypto';
import { BotError } from '../../errors.mjs';
import { id } from '../../messages.mjs';

const num = value => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
};
const listOf = (value, keys = []) => {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.values()];
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
    if (value?.[key] instanceof Map) return [...value[key].values()];
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) if (Array.isArray(child)) return child;
  }
  return [];
};
const accepted = value => value?.result === undefined || Number(value.result) === 0;
function checked(value, message = 'QQ kernel rejected the request') {
  if (!accepted(value)) throw new BotError(message, 1500);
  return value;
}
/**
 * QQNT JS bindings differ between kernel builds: the same operation may take a
 * plain argument list in one build and a descriptor object in the next. Query
 * and idempotent setters try the known shapes in order; message mutations never
 * use this helper, because a retry could duplicate a visible action.
 */
async function variants(label, attempts) {
  let last;
  for (const attempt of attempts) {
    try { return await attempt(); }
    catch (error) { last = error; }
  }
  if (last instanceof BotError) throw last;
  throw new BotError(`${label} failed: ${last?.message || 'unknown kernel error'}`, 1500);
}

const SEX = { 1: 'male', 2: 'female' };
function roleOf(member) {
  if (member?.isOwner === true) return 'owner';
  if (member?.isAdmin === true) return 'admin';
  const raw = Number(member?.role);
  // Current kernels use 0/1/2; some builds expose 0/3/4. Both sets map without
  // ambiguity, and unknown values fall back to a normal member.
  if (raw === 2 || raw === 4) return 'owner';
  if (raw === 1 || raw === 3) return 'admin';
  return 'member';
}
function memberOf(groupId, member) {
  const userId = num(member?.uin ?? member?.memberUin);
  return {
    group_id: Number(groupId),
    user_id: userId,
    nickname: String(member?.nick ?? member?.nickName ?? ''),
    card: String(member?.cardName ?? member?.card ?? ''),
    sex: SEX[Number(member?.sex)] || 'unknown',
    age: num(member?.age),
    area: String(member?.area ?? ''),
    join_time: num(member?.joinTime),
    last_sent_time: num(member?.lastSpeakTime),
    level: String(member?.memberLevel ?? member?.level ?? ''),
    role: roleOf(member),
    unfriendly: false,
    title: String(member?.title ?? ''),
    title_expire_time: num(member?.titleExpireTime),
    card_changeable: true
  };
}
function groupOf(group) {
  return {
    group_id: num(group?.groupCode ?? group?.group_id),
    group_name: String(group?.groupName ?? group?.group_name ?? ''),
    member_count: num(group?.memberCount ?? group?.member_count),
    max_member_count: num(group?.maxMemberCount ?? group?.max_member_count),
    owner_id: num(group?.groupOwner ?? group?.ownerUin ?? group?.owner_id),
    create_time: num(group?.groupCreateTime ?? group?.create_time),
    remark: String(group?.remark ?? group?.groupRemark ?? '')
  };
}

/** Opaque OneBot flags for pending friend/group requests. */
export class RequestFlags {
  constructor({ ttl = 10 * 60 * 1000, max = 200 } = {}) { this.ttl = ttl; this.max = max; this.entries = new Map(); }
  put(kind, payload) {
    const flag = randomBytes(8).toString('hex');
    this.entries.set(flag, { kind, payload, expires: Date.now() + this.ttl });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value);
    return flag;
  }
  take(flag, kind) {
    const entry = this.entries.get(String(flag || ''));
    if (!entry || entry.expires < Date.now() || entry.kind !== kind) {
      throw new BotError('Request flag is unknown or expired; fetch the request list again', 1404);
    }
    this.entries.delete(String(flag));
    return entry.payload;
  }
  cleanup() { for (const [flag, entry] of this.entries) if (entry.expires < Date.now()) this.entries.delete(flag); }
}

/**
 * Kernel commands that need no OneBot message-ID or UID mapping. Anything that
 * has to resolve a OneBot ID stays in the parent driver, which owns the SQLite
 * mapping; the host process only talks to the QQ SDK.
 */
export function createKernelActions(context, flags = new RequestFlags()) {
  const session = () => {
    const value = context.session();
    if (!value) throw new BotError('QQ session is not ready', 1501);
    return value;
  };
  const account = () => num(context.self()?.uin);
  const msgService = () => {
    const value = context.msgService();
    if (!value) throw new BotError('QQ message service is not ready', 1501);
    return value;
  };

  return {
    'account.get': () => ({ user_id: account(), nickname: String(context.self()?.nick || '') }),

    'user.get': async ({ userId }) => {
      const uin = id(userId, 'user_id');
      const profile = session().getProfileService();
      const value = await variants('QQ stranger profile query', [
        () => profile.getUserDetailInfoByUin(String(uin)),
        () => profile.getUserSimpleInfo(String(uin), true)
      ]);
      checked(value, 'QQ stranger profile query failed');
      const data = value?.userDetailInfo ?? value?.detailInfo ?? value?.coreInfo ?? value?.info ?? value ?? {};
      return {
        user_id: uin,
        nickname: String(data.nick ?? data.nickName ?? ''),
        sex: SEX[Number(data.sex)] || 'unknown',
        age: num(data.age),
        qid: String(data.qid ?? ''),
        level: num(data.level),
        remark: String(data.remark ?? ''),
        sign: String(data.sign ?? data.longNick ?? '')
      };
    },

    'group.get': async ({ groupId }) => {
      const code = id(groupId, 'group_id');
      const value = await session().getGroupService().getGroupDetailInfo(String(code), false);
      checked(value, 'QQ group info query failed');
      return groupOf(value?.groupDetailInfo ?? value?.groupInfo ?? value?.info ?? value);
    },

    'group.members': async ({ groupId }) => {
      const code = id(groupId, 'group_id');
      const value = await variants('QQ group member list query', [
        () => session().getGroupService().getAllMemberList(String(code), false),
        () => session().getGroupService().getAllMemberListV2(String(code), false)
      ]);
      checked(value, 'QQ group member list query failed');
      return listOf(value, ['memberList', 'members', 'list']).map(member => memberOf(code, member));
    },

    'group.member': async ({ groupId, userId }) => {
      const code = id(groupId, 'group_id'), uin = id(userId, 'user_id');
      const value = await session().getGroupService().getMemberInfo(String(code), String(uin), false);
      checked(value, 'QQ group member query failed');
      return memberOf(code, value?.memberInfo ?? value?.info ?? value);
    },

    /* ------------------------------------------------------------- group admin */
    'group.kick': async ({ groupId, userId, rejectAddRequest = false, reason = '' }) => {
      const code = id(groupId, 'group_id'), uin = id(userId, 'user_id');
      const text = String(reason || '').slice(0, 200);
      const value = await variants('QQ kick member', [
        () => session().getGroupService().kickMember(String(code), [String(uin)], Boolean(rejectAddRequest), text),
        () => session().getGroupService().kickMemberV2({
          groupCode: String(code), kickUids: [String(uin)], isReject: Boolean(rejectAddRequest), reason: text
        })
      ]);
      checked(value, 'QQ refused to kick this member');
      return null;
    },

    'group.ban': async ({ groupId, userId, duration = 0 }) => {
      const code = id(groupId, 'group_id'), uin = id(userId, 'user_id');
      const seconds = Math.max(0, Math.min(30 * 86400, Number(duration) || 0));
      const value = await variants('QQ mute member', [
        () => session().getGroupService().setMemberShutUp(String(code), { memberUin: String(uin), shutUpTime: seconds }),
        () => session().getGroupService().setMemberShutUp(String(code), { uin: String(uin), shutUpTime: seconds })
      ]);
      checked(value, 'QQ refused to mute this member');
      return null;
    },

    'group.whole_ban': async ({ groupId, enable }) => {
      const code = id(groupId, 'group_id');
      const value = await variants('QQ whole-group mute', [
        () => session().getGroupService().setGroupShutUp(String(code), Boolean(enable)),
        () => session().getGroupService().setGroupMute({ groupCode: String(code), isMute: Boolean(enable) })
      ]);
      checked(value, 'QQ refused to change whole-group mute');
      return null;
    },

    'group.admin': async ({ groupId, userId, enable }) => {
      const code = id(groupId, 'group_id'), uin = id(userId, 'user_id');
      const value = await variants('QQ set group admin', [
        () => session().getGroupService().modifyMemberRole(String(code), String(uin), enable ? 1 : 0),
        () => session().getGroupService().modifyMemberRole(String(code), String(uin), Boolean(enable))
      ]);
      checked(value, 'QQ refused to change this administrator');
      return null;
    },

    'group.card': async ({ groupId, userId, card }) => {
      const code = id(groupId, 'group_id'), uin = id(userId, 'user_id');
      const value = await session().getGroupService()
        .modifyMemberCardName(String(code), String(uin), String(card ?? '').slice(0, 60));
      checked(value, 'QQ refused to change this group card');
      return null;
    },

    'group.rename': async ({ groupId, groupName }) => {
      const code = id(groupId, 'group_id'), name = String(groupName ?? '').trim();
      if (!name || name.length > 60) throw new BotError('group_name must contain 1-60 characters', 1400);
      const value = await variants('QQ rename group', [
        () => session().getGroupService().modifyGroupName(String(code), name, false),
        () => session().getGroupService().modifyGroupName(String(code), name, 0)
      ]);
      checked(value, 'QQ refused to rename this group');
      return null;
    },

    'group.leave': async ({ groupId, isDismiss = false }) => {
      const code = id(groupId, 'group_id');
      const group = await session().getGroupService().getGroupDetailInfo(String(code), false).catch(() => null);
      const info = group?.groupDetailInfo ?? group?.groupInfo ?? group ?? {};
      const owner = num(info.groupOwner ?? info.ownerUin) === account();
      const value = owner || isDismiss
        ? await session().getGroupService().destroyGroup(String(code))
        : await session().getGroupService().quitGroup(String(code));
      checked(value, 'QQ refused to leave this group');
      return null;
    },

    'group.remark': async ({ groupId, remark }) => {
      const code = id(groupId, 'group_id');
      const value = await session().getGroupService().modifyGroupRemark(String(code), String(remark ?? '').slice(0, 60));
      checked(value, 'QQ refused to change this group remark');
      return null;
    },

    'group.title': async ({ groupId, userId, title }) => {
      const code = id(groupId, 'group_id'), uin = id(userId, 'user_id');
      const text = String(title ?? '').slice(0, 18);
      const value = await variants('QQ set group title', [
        () => session().getGroupService().setIdentityTitleInfo({
          groupCode: String(code), memberUin: String(uin), title: text
        }),
        () => session().getGroupService().setGroupIdentitySpec({
          groupCode: String(code), memberUin: String(uin), title: text
        })
      ]);
      checked(value, 'QQ refused to change this member title');
      return null;
    },

    /* ------------------------------------------------------------ group files */
    'group.files': async ({ groupId, start = 0, count = 50 }) => {
      const code = id(groupId, 'group_id');
      const value = await variants('QQ group file list', [
        () => session().getRichMediaService().getGroupFileList(String(code),
          { fileIndex: Number(start) || 0, fileCount: Math.min(200, Math.max(1, Number(count) || 50)), sortType: 1 }),
        () => session().getRichMediaService().getGroupFileList(String(code),
          { fileIndex: Number(start) || 0, fileCount: Math.min(200, Math.max(1, Number(count) || 50)) })
      ]);
      checked(value, 'QQ group file list failed');
      return listOf(value, ['fileList', 'files']).map(file => ({
        group_id: Number(code), file_id: String(file.fileId ?? file.fileUuid ?? ''),
        file_name: String(file.fileName ?? file.name ?? ''), busid: num(file.busId),
        file_size: num(file.fileSize), upload_time: num(file.uploadTime ?? file.createTime),
        dead_time: num(file.deadTime), modify_time: num(file.modifyTime),
        download_times: num(file.downloadTimes), uploader: num(file.uploaderUin ?? file.uploader),
        uploader_name: String(file.uploaderName ?? ''),
        ...(file.fileUrl || file.downloadUrl ? { url: String(file.fileUrl ?? file.downloadUrl) } : {})
      }));
    },

    'group.file.delete': async ({ groupId, fileId, busid = 0 }) => {
      const code = id(groupId, 'group_id');
      const value = await variants('QQ delete group file', [
        () => session().getRichMediaService().deleteGroupFile(String(code), String(fileId), Number(busid) || 0),
        () => session().getRichMediaService().deleteGroupFile(String(code), [String(fileId)], Number(busid) || 0)
      ]);
      checked(value, 'QQ refused to delete this group file');
      return null;
    },

    'group.file.space': async ({ groupId }) => {
      const code = id(groupId, 'group_id');
      const value = await session().getRichMediaService().getGroupSpace(String(code));
      checked(value, 'QQ group file space query failed');
      const data = value?.groupSpace ?? value ?? {};
      return { total_space: num(data.totalSpace), used_space: num(data.usedSpace) };
    },

    /* --------------------------------------------------------------- bulletins */
    'group.notices': async ({ groupId }) => {
      const code = id(groupId, 'group_id');
      const value = await session().getGroupService().getGroupBulletin(String(code));
      checked(value, 'QQ group notice query failed');
      return listOf(value, ['groupBulletinList', 'bulletinList', 'list']).map(notice => ({
        notice_id: String(notice.feedId ?? notice.bulletinId ?? notice.noticeId ?? ''),
        sender_id: num(notice.senderUin ?? notice.uin),
        publish_time: num(notice.publishTime ?? notice.time),
        message: {
          text: String(notice.content ?? notice.text ?? ''),
          images: listOf(notice, ['pics', 'images']).map(pic => ({ file: String(pic.url ?? pic.picUrl ?? '') })),
          image: String(notice.picUrl ?? '')
        }
      }));
    },

    'group.notice.send': async ({ groupId, content, image, pinned = 0 }) => {
      const code = id(groupId, 'group_id'), text = String(content ?? '');
      if (!text && !image) throw new BotError('content is required', 1400);
      const extra = { isPinned: Boolean(pinned), pinned: Number(pinned) || 0 };
      const value = await variants('QQ publish group notice', [
        () => session().getGroupService().publishGroupBulletin(String(code), text, extra),
        () => session().getGroupService().publishGroupBulletin(String(code), text, Boolean(pinned))
      ]);
      checked(value, 'QQ refused to publish this group notice');
      return { notice_id: String(value?.feedId ?? value?.bulletinId ?? '') };
    },

    'group.notice.delete': async ({ groupId, noticeId }) => {
      const code = id(groupId, 'group_id');
      const value = await variants('QQ delete group notice', [
        () => session().getGroupService().deleteGroupBulletin(String(code), String(noticeId), 0),
        () => session().getGroupService().deleteGroupBulletin(String(code), String(noticeId), false)
      ]);
      checked(value, 'QQ refused to delete this group notice');
      return null;
    },

    /* --------------------------------------------------------------- group meta */
    'group.honor': async ({ groupId, type = 'all' }) => {
      const code = id(groupId, 'group_id');
      const value = await session().getGroupService().getGroupHonorList({
        groupCode: String(code), type: String(type || 'all')
      });
      checked(value, 'QQ group honor query failed');
      return value?.honorList ?? value ?? {};
    },

    'group.shut_list': async ({ groupId }) => {
      const code = id(groupId, 'group_id');
      const value = await variants('QQ muted member list', [
        () => session().getGroupService().getGroupShutUpMemberList(String(code)),
        () => session().getGroupService().queryGroupMuteMemberList({ groupCode: String(code) })
      ]);
      checked(value, 'QQ muted member list failed');
      return listOf(value, ['memberList', 'list']).map(member => ({
        user_id: num(member.uin ?? member.memberUin), nickname: String(member.nick ?? ''),
        card: String(member.cardName ?? ''), mute_time: num(member.shutUpTime)
      }));
    },

    'group.at_all_remain': async ({ groupId }) => {
      const code = id(groupId, 'group_id');
      const value = await variants('QQ @all quota query', [
        () => session().getGroupService().getGroupRemainAtTimes({ groupCode: String(code) }),
        () => session().getGroupService().getGroupRemainAtTimes(String(code))
      ]);
      checked(value, 'QQ @all quota query failed');
      const data = value?.atTimesInfo ?? value ?? {};
      return {
        at_all_remain: num(data.remainAtTimes ?? data.remain),
        at_all_remain_when_no_at: num(data.remainAtTimesWhenNoAt ?? data.remain),
        can_at_all: data.canAtAll !== false
      };
    },

    'group.essence.list': async ({ groupId }) => {
      const code = id(groupId, 'group_id');
      const value = await variants('QQ essence message list', [
        () => session().getGroupService().fetchGroupEssenceListV2({ groupCode: String(code), pageStart: 0, pageLimit: 50 }),
        () => session().getGroupService().fetchGroupEssenceList(String(code), 0)
      ]);
      checked(value, 'QQ essence message list failed');
      return listOf(value, ['msgList', 'essenceList', 'list']);
    },

    /* ------------------------------------------------------------- interactions */
    'send_poke': async ({ chatType, peerUid, targetUin }) => {
      const value = await variants('QQ send poke', [
        () => msgService().sendNudge({ chatType: Number(chatType), peerUid: String(peerUid), guildId: '' }, String(targetUin), 0),
        () => msgService().sendNudge({ chatType: Number(chatType), peerUid: String(peerUid), guildId: '' }, String(targetUin), 1)
      ]);
      checked(value, 'QQ refused to send this poke');
      return null;
    },

    'send_like': async ({ userId, times = 1 }) => {
      const uin = String(id(userId, 'user_id')), count = Math.min(20, Math.max(1, Number(times) || 1));
      const service = session().getProfileLikeService();
      const value = await variants('QQ send profile like', [
        () => service.setBuddyProfileLike({ friendUin: uin, count }),
        () => service.setBuddyProfileLike({ uin, count }),
        () => service.setBuddyProfileLike({ friendUin: uin, times: count })
      ]);
      checked(value, 'QQ refused to send this like');
      return null;
    },

    /* --------------------------------------------------------------- requests */
    'friend.requests': async () => {
      const value = await session().getBuddyService().getBuddyReq();
      checked(value, 'QQ friend request query failed');
      return listOf(value, ['buddyRequestList', 'reqList', 'list', 'requests']).map(request => ({
        flag: flags.put('friend', request),
        user_id: num(request.uin ?? request.friendUin) || num(context.uidToUin?.(request.uid)),
        nickname: String(request.nick ?? request.nickName ?? request.remark ?? ''),
        comment: String(request.msg ?? request.verifyMessage ?? ''),
        source: String(request.source ?? ''),
        time: num(request.reqTime ?? request.time)
      }));
    },

    'friend.request': async ({ flag, approve, remark = '' }) => {
      const request = flags.take(flag, 'friend');
      const uid = String(request.uid ?? request.friendUid ?? '');
      if (!uid) throw new BotError('Friend request has no UID', 1404);
      const value = await variants('QQ handle friend request', [
        () => session().getBuddyService().approvalFriendRequest({ friendUid: uid, isAgree: Boolean(approve), remark: String(remark || '') }),
        () => session().getBuddyService().approvalFriendRequest({ uid, isAgree: Boolean(approve), remark: String(remark || '') })
      ]);
      checked(value, 'QQ refused this friend request');
      return null;
    },

    'group.requests': async () => {
      const service = session().getGroupService();
      const value = await variants('QQ group request query', [
        () => service.getSingleScreenNotifiesV2(true, 20, 0, 0),
        () => service.getSingleScreenNotifies(true, 20, 0)
      ]);
      checked(value, 'QQ group request query failed');
      return listOf(value, ['notifies', 'notifyList', 'list']).map(notify => ({
        flag: flags.put('group', notify),
        group_id: num(notify.groupCode ?? notify.group_id),
        user_id: num(notify.memberUin ?? notify.targetUin ?? notify.invitorUin) ||
          num(context.uidToUin?.(notify.memberUid ?? notify.invitorUid)),
        nickname: String(notify.memberNick ?? notify.nick ?? notify.invitorNick ?? ''),
        comment: String(notify.content ?? notify.msg ?? ''),
        type: Number(notify.notifyType) === 2 || Number(notify.notifyType) === 8 ? 'invite' : 'add',
        sub_type: Number(notify.notifyType) === 2 || Number(notify.notifyType) === 8 ? 'invite' : 'add',
        time: num(notify.time ?? notify.notifyTime)
      }));
    },

    'group.request': async ({ flag, approve }) => {
      const notify = flags.take(flag, 'group');
      const service = session().getGroupService();
      const value = await variants('QQ handle group request', [
        () => service.operateSysNotify(Boolean(approve), notify),
        () => service.operateSysNotifyV2(Boolean(approve), notify)
      ]);
      checked(value, 'QQ refused this group request');
      return null;
    },

    /* ------------------------------------------------------------------ misc */
    'recent.list': async () => {
      const value = await session().getRecentContactService().getRecentContactList();
      checked(value, 'QQ recent contact query failed');
      return listOf(value, ['contactList', 'list']).map(contact => ({
        type: Number(contact.chatType) === 2 ? 'group' : 'private',
        target_id: num(contact.peerUin ?? contact.peerUid),
        time: num(contact.lastMsgTime ?? contact.time),
        unread: num(contact.unreadCnt ?? contact.unread)
      }));
    },

    'profile.set': async ({ nickname, signature, sex }) => {
      const payload = {};
      if (nickname !== undefined) payload.nick = String(nickname).slice(0, 36);
      if (signature !== undefined) payload.longNick = String(signature).slice(0, 200);
      if (sex !== undefined) payload.sex = sex === 'male' ? 1 : sex === 'female' ? 2 : 0;
      if (!Object.keys(payload).length) throw new BotError('No supported profile field was supplied', 1400);
      const value = await session().getProfileService().modifySelfProfile(payload);
      checked(value, 'QQ refused to update the profile');
      return null;
    },

    'friend.delete': async ({ userId }) => {
      const value = await session().getBuddyService().delBuddy(String(id(userId, 'user_id')));
      checked(value, 'QQ refused to delete this friend');
      return null;
    },

    'friend.remark': async ({ userId, remark }) => {
      const value = await session().getBuddyService()
        .setBuddyRemark({ uin: String(id(userId, 'user_id')), remark: String(remark ?? '').slice(0, 60) });
      checked(value, 'QQ refused to update this friend remark');
      return null;
    },

    'friend.doubt': async () => {
      const service = session().getBuddyService();
      const value = await variants('QQ unidirectional friend list', [
        () => service.getDoubtBuddyReq(true, 50, 0),
        () => service.getDoubtBuddyReq(50, 0, true)
      ]);
      checked(value, 'QQ unidirectional friend list failed');
      return listOf(value, ['doubtBuddyReqList', 'reqList', 'list']).map(item => ({
        user_id: num(item.uin ?? item.friendUin) || num(context.uidToUin?.(item.uid)),
        nickname: String(item.nick ?? item.nickName ?? ''),
        source: String(item.source ?? '')
      }));
    },

    'devices.list': async () => {
      const value = await msgService().getOnLineDev();
      checked(value, 'QQ online device query failed');
      return listOf(value, ['devList', 'devices', 'list']).map(device => ({
        app_id: num(device.appId),
        device_name: String(device.devName ?? device.name ?? ''),
        device_kind: String(device.devType ?? device.type ?? '')
      }));
    },

    'message.read': async ({ chatType, peerUid }) => {
      const value = await msgService().setMsgRead({ chatType: Number(chatType), peerUid: String(peerUid), guildId: '' });
      checked(value, 'QQ mark-as-read failed');
      return null;
    },

    'message.recall': async ({ chatType, peerUid, msgId }) => {
      const value = await msgService().recallMsg({ chatType: Number(chatType), peerUid: String(peerUid), guildId: '' }, [String(msgId)]);
      checked(value, 'QQ refused to recall this message');
      return null;
    },

    'message.ptt_text': async ({ chatType, peerUid, msgId }) => {
      const value = await msgService().translatePtt2Text(
        { chatType: Number(chatType), peerUid: String(peerUid), guildId: '' }, String(msgId), true);
      checked(value, 'QQ voice transcription failed');
      return { text: String(value?.text ?? value?.result ?? '') };
    },

    'group.essence.add': async ({ groupId, msgId }) => {
      const value = await session().getGroupService().addGroupEssence({
        groupCode: String(id(groupId, 'group_id')), msgId: String(msgId), chatType: 2
      });
      checked(value, 'QQ refused to add this essence message');
      return null;
    },

    'group.essence.remove': async ({ groupId, msgId }) => {
      const value = await session().getGroupService().removeGroupEssence({
        groupCode: String(id(groupId, 'group_id')), msgId: String(msgId), chatType: 2
      });
      checked(value, 'QQ refused to remove this essence message');
      return null;
    }
  };
}

export function cleanupFlags(flags) { flags.cleanup(); }
