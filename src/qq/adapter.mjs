import { EventEmitter } from 'node:events';
import { BotError, deadline } from '../errors.mjs';
import { id, boolean, parseMessage, toCQ } from '../messages.mjs';
import { SendLimiter } from '../limiter.mjs';
import { hasMedia } from './kernel/elements.mjs';
import { PROJECT_ID } from '../brand.mjs';

const VERSION = '0.1.0';
const positive = (value, name) => id(value, name);
const messageId = value => id(value, 'message_id', { signed: true });

export class QQAdapter extends EventEmitter {
  constructor(driver, config) {
    super(); this.driver = driver; this.config = config;
    this.controller = new AbortController();
    this.limiter = new SendLimiter(config.sendInterval, config.sessionInterval,
      { concurrency: config.sendConcurrency, maxPending: config.maxPendingSends });
    driver.on('message', m => {
      try {
        const user = id(m.sender?.user_id, 'sender.user_id');
        if (!['private', 'group'].includes(m.kind)) throw new BotError('Invalid driver message kind', 1400);
        const message = parseMessage(m.message);
        const event = { time: m.time ?? Math.floor(Date.now() / 1000), self_id: id(driver.account, 'account'),
          post_type: user === driver.account ? 'message_sent' : 'message', message_type: m.kind,
          sub_type: m.subType || (m.kind === 'group' ? 'normal' : 'friend'),
          message_id: id(m.id, 'message id', { signed: true }), user_id: user,
          ...(Number(m.seq) > 0 ? { message_seq: Number(m.seq) } : {}),
          message, raw_message: toCQ(message), font: 0, sender: { ...m.sender, user_id: user } };
        if (m.kind === 'group') { event.group_id = id(m.groupId, 'group ID'); event.anonymous = m.anonymous ?? null; }
        this.emit('event', event);
      } catch (e) { this.emit('fault', e); }
    });
    for (const type of ['notice', 'request']) driver.on(type, fields => {
      // These fields must already follow the documented OneBot event schemas.
      this.emit('event', { ...fields, time: fields.time ?? Math.floor(Date.now() / 1000),
        self_id: driver.account, post_type: type });
    });
    this.reconnectAttempt = 0; this.reconnectEnabled = true;
    driver.on('state', state => {
      if (driver.online) { this.reconnectAttempt = 0; clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      else if (state.reconnect === true) this.scheduleReconnect();
      else if (state.reconnect === false) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      this.emit('state');
    });
    driver.on('fault', error => this.emit('fault', error));
  }
  status() { return { online: this.driver.online === true, good: this.driver.online === true,
    driver: this.driver.mode, simulated: this.driver.mode === 'demo',
    ...(this.driver.diagnostics ? { [this.driver.mode === 'kernel' ? 'kernel' : 'native']: this.driver.diagnostics() } : {}) }; }
  async start() {
    try {
      await deadline(signal => this.driver.connect({ signal }), this.config.startupTimeout ?? this.config.rpcTimeout, { signal: this.controller.signal });
    } catch (error) {
      if (error.retryable) this.scheduleReconnect();
      if (error.message === 'Driver operation timed out') {
        const failure = new BotError('QQ 驱动启动超时。请重新启动；官方内核的诊断日志位于 QQ 内核数据目录中的 host-stderr.log。', 1502);
        failure.reason = 'qq_startup_timeout'; failure.startupStage = this.driver.diagnostics?.().startup_stage || 'connecting'; throw failure;
      }
      throw error;
    }
  }
  scheduleReconnect() {
    if (this.controller.signal.aborted || this.reconnectTimer || !this.reconnectEnabled) return;
    const wait = Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempt++, 5)) + Math.floor(Math.random() * 300);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start().catch(error => this.emit('fault', error));
    }, wait);
  }
  async close() { clearTimeout(this.reconnectTimer); this.limiter.close(); this.controller.abort(); await this.driver.close(); }
  async invoke(command, params = {}, { mutation = false, signal } = {}) {
    const combined = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
    if (!this.driver.online && !command.startsWith('auth.')) throw new BotError('QQ driver is offline or not implemented', 1501, { retryable: true });
    const timeout = command === 'message.get' || command === 'message.history' || command === 'image.get' ||
      command === 'profile.set_avatar' ||
      (command === 'message.send' && hasMedia(params.message)) || String(command).startsWith('group.file')
      ? this.config.media?.timeout || 90000 : this.config.rpcTimeout;
    return deadline(s => this.driver.invoke(command, params, { signal: s }), timeout, { mutation, signal: combined });
  }
  async send(kind, target, params, context) {
    const message = parseMessage(params.message, boolean(params.auto_escape));
    const signal = context.signal ? AbortSignal.any([context.signal, this.controller.signal]) : this.controller.signal;
    const result = await this.limiter.run(`${kind}:${target}`, () => this.invoke('message.send', { kind, target, message },
      { ...context, mutation: true, signal }), signal);
    this.emit('outgoing', { time: Math.floor(Date.now() / 1000), self_id: this.driver.account,
      post_type: 'message_sent', message_type: kind, message_id: result?.message_id,
      user_id: this.driver.account, target_id: target, ...(kind === 'group' ? { group_id: target } : {}),
      sender: { user_id: this.driver.account }, message, raw_message: toCQ(message) });
    return result;
  }
  async action(action, params = {}, context = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new BotError('params must be an object', 1400);
    const call = (command, value = {}, mutation = false) => this.invoke(command, value, { ...context, mutation });
    switch (action) {
      /* --------------------------------------------------------------- status */
      case 'get_status': return this.status();
      case 'get_version_info': return { app_name: PROJECT_ID, app_version: VERSION, protocol_version: 'v11',
        onebot_version: 'v11', runtime: `node ${process.version}` };
      case 'can_send_image': return { yes: this.driver.capabilities.includes('media.image') };
      case 'can_send_record': return { yes: this.driver.capabilities.includes('media.record') };
      case 'can_send_file': return { yes: this.driver.capabilities.includes('media.file') };
      case 'get_login_info': return this.driver.capabilities.includes('account.get') ? call('account.get')
        : { user_id: this.driver.account || 0, nickname: '' };
      case 'get_friend_list': return call('friend.list');
      case 'get_group_list': return call('group.list');

      /* ---------------------------------------------------------------- users */
      case 'get_stranger_info': return call('user.get', { userId: positive(params.user_id, 'user_id') });
      case 'get_group_info': return call('group.get', { groupId: positive(params.group_id, 'group_id') });
      case 'get_group_member_list': return call('group.members', { groupId: positive(params.group_id, 'group_id') });
      case 'get_group_member_info': return call('group.member', {
        groupId: positive(params.group_id, 'group_id'), userId: positive(params.user_id, 'user_id') });

      /* -------------------------------------------------------------- messages */
      case 'get_msg': return call('message.get', { messageId: messageId(params.message_id) });
      case 'delete_msg': return call('message.delete', { messageId: messageId(params.message_id) }, true);
      case 'get_image': return call('image.get', { file: String(params.file || '') });
      case 'get_group_msg_history': return call('message.history', {
        kind: 'group', target: positive(params.group_id, 'group_id'),
        count: params.count, message_seq: params.message_seq ?? params.message_id });
      case 'get_friend_msg_history': return call('message.history', {
        kind: 'private', target: positive(params.user_id, 'user_id'),
        count: params.count, message_seq: params.message_seq ?? params.message_id });
      case 'mark_msg_as_read': {
        if (params.message_id !== undefined) {
          const message = await call('message.get', { messageId: messageId(params.message_id) });
          const kind = message.message_type === 'group' ? 'group' : 'private';
          const target = kind === 'group' ? message.group_id : message.sender?.user_id;
          return call('message.read', { kind, target });
        }
        const kind = params.group_id !== undefined ? 'group' : 'private';
        return call('message.read', { kind, target: positive(kind === 'group' ? params.group_id : params.user_id, 'target') });
      }
      case 'get_forward_msg':
        throw new BotError('Forwarded-message nodes are not retained by this protocol side', 1404);
      case 'send_forward_msg':
      case 'send_group_forward_msg':
        throw new BotError('This kernel build exposes no verified forward-node builder; send the messages separately', 1404);

      /* ------------------------------------------------------------- send text */
      case 'send_msg':
      case 'send_private_msg':
      case 'send_group_msg': {
        const kind = action === 'send_private_msg' ? 'private' : action === 'send_group_msg' ? 'group' :
          (params.message_type ?? (params.group_id !== undefined ? 'group' : 'private'));
        if (!['private', 'group'].includes(kind)) throw new BotError('Invalid message_type', 1400);
        const target = positive(kind === 'group' ? params.group_id : params.user_id, `${kind} target`);
        return this.send(kind, target, params, context);
      }

      /* ---------------------------------------------------------------- files */
      case 'upload_group_file': {
        const target = positive(params.group_id, 'group_id');
        const file = { file: String(params.file || ''), name: params.name ? String(params.name) : undefined };
        return this.send('group', target, { message: [{ type: 'file', data: file }] }, context);
      }
      case 'upload_private_file': {
        const target = positive(params.user_id, 'user_id');
        const file = { file: String(params.file || ''), name: params.name ? String(params.name) : undefined };
        return this.send('private', target, { message: [{ type: 'file', data: file }] }, context);
      }
      case 'get_group_file_list': return call('group.files', {
        groupId: positive(params.group_id, 'group_id'), start: params.start, count: params.count });
      case 'delete_group_file': return call('group.file.delete', {
        groupId: positive(params.group_id, 'group_id'), fileId: String(params.file_id || ''),
        busid: params.busid }, true);
      case 'get_group_file_url': {
        const groupId = positive(params.group_id, 'group_id');
        const files = await call('group.files', { groupId, start: 0, count: 200 });
        const found = files.find(file => String(file.file_id) === String(params.file_id));
        if (!found?.url) throw new BotError('This kernel build does not expose a group file URL', 1404);
        return { url: found.url };
      }
      case 'get_group_file_system_info': return call('group.file.space', { groupId: positive(params.group_id, 'group_id') });

      /* -------------------------------------------------------------- notices */
      case 'get_group_notice':
      case '_get_group_notice': return call('group.notices', { groupId: positive(params.group_id, 'group_id') });
      case '_send_group_notice':
      case 'send_group_notice': return call('group.notice.send', {
        groupId: positive(params.group_id, 'group_id'), content: params.content, image: params.image,
        pinned: params.pinned }, true);
      case '_del_group_notice':
      case 'delete_group_notice': return call('group.notice.delete', {
        groupId: positive(params.group_id, 'group_id'), noticeId: String(params.notice_id || params.feed_id || '') }, true);

      /* --------------------------------------------------------------- essence */
      case 'get_essence_msg_list': return call('group.essence.list', { groupId: positive(params.group_id, 'group_id') });
      case 'set_essence_msg': return call('group.essence.add', {
        groupId: positive(params.group_id, 'group_id'), messageId: messageId(params.message_id) }, true);
      case 'delete_essence_msg': return call('group.essence.remove', {
        groupId: positive(params.group_id, 'group_id'), messageId: messageId(params.message_id) }, true);

      /* ---------------------------------------------------------- group manage */
      case 'set_group_kick': return call('group.kick', {
        groupId: positive(params.group_id, 'group_id'), userId: positive(params.user_id, 'user_id'),
        rejectAddRequest: boolean(params.reject_add_request), reason: params.reason }, true);
      case 'set_group_ban': return call('group.ban', {
        groupId: positive(params.group_id, 'group_id'), userId: positive(params.user_id, 'user_id'),
        duration: Number(params.duration) || 0 }, true);
      case 'set_group_whole_ban': return call('group.whole_ban', {
        groupId: positive(params.group_id, 'group_id'), enable: boolean(params.enable, true) }, true);
      case 'set_group_admin': return call('group.admin', {
        groupId: positive(params.group_id, 'group_id'), userId: positive(params.user_id, 'user_id'),
        enable: boolean(params.enable, true) }, true);
      case 'set_group_card': return call('group.card', {
        groupId: positive(params.group_id, 'group_id'), userId: positive(params.user_id, 'user_id'),
        card: params.card }, true);
      case 'set_group_name': return call('group.rename', {
        groupId: positive(params.group_id, 'group_id'), groupName: params.group_name }, true);
      case 'set_group_leave': return call('group.leave', {
        groupId: positive(params.group_id, 'group_id'), isDismiss: boolean(params.is_dismiss) }, true);
      case 'set_group_remark': return call('group.remark', {
        groupId: positive(params.group_id, 'group_id'), remark: params.remark }, true);
      case 'set_group_special_title': return call('group.title', {
        groupId: positive(params.group_id, 'group_id'), userId: positive(params.user_id, 'user_id'),
        title: params.special_title }, true);
      case 'get_group_honor_info': return call('group.honor', {
        groupId: positive(params.group_id, 'group_id'), type: params.type });
      case 'get_group_shut_list': return call('group.shut_list', { groupId: positive(params.group_id, 'group_id') });
      case 'get_group_at_all_remain': return call('group.at_all_remain', { groupId: positive(params.group_id, 'group_id') });

      /* -------------------------------------------------------------- requests */
      case 'get_friend_add_request': return call('friend.requests');
      case 'set_friend_add_request': return call('friend.request', {
        flag: String(params.flag || ''), approve: boolean(params.approve), remark: params.remark }, true);
      case 'get_group_add_request': return call('group.requests');
      case 'set_group_add_request': {
        const subType = params.sub_type === undefined ? 'add' : String(params.sub_type);
        if (!['add', 'invite'].includes(subType)) throw new BotError('sub_type must be add or invite', 1400);
        return call('group.request', { flag: String(params.flag || ''), approve: boolean(params.approve),
          reason: params.reason }, true);
      }

      /* ---------------------------------------------------------------- social */
      case 'send_poke': {
        const kind = params.group_id !== undefined ? 'group' : 'private';
        return call('send_poke', { kind, target: positive(kind === 'group' ? params.group_id : params.user_id, 'target'),
          userId: positive(params.user_id, 'user_id') }, true);
      }
      case 'send_like': return call('send_like', { userId: positive(params.user_id, 'user_id'),
        times: Number(params.times) || 1 }, true);
      case 'get_recent_contact': return call('recent.list');
      case 'set_qq_profile': return call('profile.set', {
        nickname: params.nickname, signature: params.signature ?? params.personal_note, sex: params.sex }, true);
      case 'set_qq_avatar': {
        const file = String(params.file || '').trim();
        if (!file) throw new BotError('Avatar image source is required', 1400);
        return call('profile.set_avatar', { file }, true);
      }
      case 'delete_friend': return call('friend.delete', { userId: positive(params.user_id, 'user_id') }, true);
      case 'set_friend_remark': return call('friend.remark', {
        userId: positive(params.user_id, 'user_id'), remark: params.remark }, true);
      case 'get_unidirectional_friend_list': return call('friend.doubt');
      case 'get_online_clients': return call('devices.list');

      /* ----------------------------------------------------------------- voice */
      case 'fetch_ptt_text': return call('message.ptt_text', { messageId: messageId(params.message_id) });

      case 'set_restart':
      case 'clean_cache':
        throw new BotError('This protocol side does not manage its host process; restart it from the console', 1404);
      default: throw new BotError('OneBot action is not implemented', 1404);
    }
  }
  async login(command, params) {
    if (!['start', 'poll', 'logout'].includes(command)) throw new BotError('Unknown login operation', 1404);
    if (command === 'logout') {
      this.reconnectEnabled = false; clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
    } else if (command === 'start') this.reconnectEnabled = true;
    return this.invoke(`auth.${command}`, params, { mutation: true });
  }
}
