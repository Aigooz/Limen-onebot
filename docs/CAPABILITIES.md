# 动作与内核方法对照

本文件记录每个 OneBot 动作最终调用的内核方法、参数个数，以及实现状态。

- **内核方法**来自当前运行时 `wrapper.node` 的断言字符串（`NodeIKernelXxxService::method needs N arguments`），不是猜测。
- **参数个数**是内核强制的；个数不符会直接被原生层拒绝。
- **状态**：`已接线` 表示代码路径完整、协议层自测通过；`未验收` 表示还需要真实账号验证；`未支持` 表示明确不做。

> 除登录与协议层外，所有 QQ 动作均未完成真实账号验收。见 README 的验证表。

## 账号与好友

| OneBot 动作 | 内核方法 | 说明 | 状态 |
| --- | --- | --- | --- |
| `get_login_info` | `account.get`（宿主内部） | 宿主返回当前账号与昵称 | 已接线，未验收 |
| `get_friend_list` | `BuddyService.getBuddyListV2(3)` + `ProfileService.getCoreAndBaseInfo(2)` | 兼容 2/3 参数版本；UID→UIN 转换 | 已接线，未验收 |
| `get_stranger_info` | `ProfileService.getUserDetailInfoByUin(1)`，回退 `getUserSimpleInfo(2)` | 昵称、性别、年龄、签名、QID | 已接线，未验收 |
| `set_qq_profile` | `ProfileService.modifySelfProfile(1)` | 昵称/签名/性别 | 已接线，未验收 |
| `delete_friend` | `BuddyService.delBuddy(1)` | | 已接线，未验收 |
| `set_friend_remark` | `BuddyService.setBuddyRemark(1)` | | 已接线，未验收 |
| `send_like` | `ProfileLikeService.setBuddyProfileLike(1)` | 名片点赞，1–20 次 | 已接线，未验收 |
| `get_unidirectional_friend_list` | `BuddyService.getDoubtBuddyReq(3)` | 单向好友/陌生人请求，两种参数顺序回退 | 已接线，未验收 |
| `get_online_clients` | `MsgService.getOnLineDev(0)` | 在线设备列表 | 已接线，未验收 |

## 群资料与成员

| OneBot 动作 | 内核方法 | 说明 | 状态 |
| --- | --- | --- | --- |
| `get_group_list` | `GroupService.getGroupList(1)` | 返回群号、群名、人数 | 已接线，未验收 |
| `get_group_info` | `GroupService.getGroupDetailInfo(2)` | 群主、创建时间、备注 | 已接线，未验收 |
| `get_group_member_list` | `GroupService.getAllMemberList(2)`，回退 `getAllMemberListV2(2)` | 角色按 0/1/2 与 0/3/4 两套枚举兼容映射 | 已接线，未验收 |
| `get_group_member_info` | `GroupService.getMemberInfo(3)` | 单成员 | 已接线，未验收 |
| `get_group_shut_list` | `GroupService.getGroupShutUpMemberList(1)`，回退 `queryGroupMuteMemberList(1)` | | 已接线，未验收 |
| `get_group_honor_info` | `GroupService.getGroupHonorList(1)` | 原样返回内核荣誉结构 | 已接线，未验收 |
| `get_group_at_all_remain` | `GroupService.getGroupRemainAtTimes(1)` | | 已接线，未验收 |
| `get_recent_contact` | `RecentContactService.getRecentContactList(0)` | 类型、目标、时间、未读 | 已接线，未验收 |

## 消息

| OneBot 动作 | 内核方法 | 说明 | 状态 |
| --- | --- | --- | --- |
| `send_private_msg` / `send_group_msg` / `send_msg` | `MsgService.sendMsg(4)` | 文本、@、引用、图片、表情、语音、文件；终态确认后才返回 | 已接线，文本/图片有历史实测 |
| `get_msg` | 本地缓存 + `MsgService.getMsgsByMsgId(2)` | 图片缺失时回拉原图 | 已接线 |
| `delete_msg` | `MsgService.recallMsg(2)` | 需要本地保留的原生消息键 | 已接线，未验收 |
| `get_group_msg_history` / `get_friend_msg_history` | `MsgService.getMsgsBySeqAndCount(5)` | 最多 100 条；逐条解析发送者 | 已接线，未验收 |
| `mark_msg_as_read` | `MsgService.setMsgRead(1)` | 可按 `message_id` 或目标 | 已接线，未验收 |
| `fetch_ptt_text` | `MsgService.translatePtt2Text(3)` | 语音转文字（扩展动作） | 已接线，未验收 |
| `send_poke` | `MsgService.sendNudge(3)` | 戳一戳 | 已接线，未验收 |

## 群管理

| OneBot 动作 | 内核方法 | 说明 | 状态 |
| --- | --- | --- | --- |
| `set_group_kick` | `GroupService.kickMember(4)`，回退 `kickMemberV2(1)` | 可带拒绝再次加群与理由 | 已接线，未验收 |
| `set_group_ban` | `GroupService.setMemberShutUp(2)` | 秒数，0 为解除 | 已接线，未验收 |
| `set_group_whole_ban` | `GroupService.setGroupShutUp(2)`，回退 `setGroupMute(1)` | | 已接线，未验收 |
| `set_group_admin` | `GroupService.modifyMemberRole(3)` | 1 = 管理员，0 = 普通成员 | 已接线，未验收 |
| `set_group_card` | `GroupService.modifyMemberCardName(3)` | | 已接线，未验收 |
| `set_group_name` | `GroupService.modifyGroupName(3)` | | 已接线，未验收 |
| `set_group_leave` | `GroupService.quitGroup(1)` / `destroyGroup(1)` | 先查群主身份，群主走解散 | 已接线，未验收 |
| `set_group_remark` | `GroupService.modifyGroupRemark(2)` | 我的群备注 | 已接线，未验收 |
| `set_group_special_title` | `GroupService.setIdentityTitleInfo(1)`，回退 `setGroupIdentitySpec(1)` | 参数结构未验证 | 已接线，未验收 |

## 请求处理

| OneBot 动作 | 内核方法 | 说明 | 状态 |
| --- | --- | --- | --- |
| `get_friend_add_request` | `BuddyService.getBuddyReq(0)` | 每次查询生成新的不透明 flag | 已接线，未验收 |
| `set_friend_add_request` | `BuddyService.approvalFriendRequest(1)` | flag 在本进程内有效 | 已接线，未验收 |
| `get_group_add_request` | `GroupService.getSingleScreenNotifiesV2(4)`，回退 `getSingleScreenNotifies(3)` | 入群/邀请 | 已接线，未验收 |
| `set_group_add_request` | `GroupService.operateSysNotify(2)`，回退 `operateSysNotifyV2(2)` | flag 携带完整通知对象 | 已接线，未验收 |

flag 由内核宿主在内存中保存，TTL 10 分钟、最多 200 条。进程重启后需要重新拉取请求列表。

## 文件

| OneBot 动作 | 内核方法 | 说明 | 状态 |
| --- | --- | --- | --- |
| `upload_group_file` / `upload_private_file` | `MsgService.sendMsg(4)` + `fileElement` | 仅本地路径或 `file://`；单条消息一个文件 | 已接线，未验收 |
| `get_group_file_list` | `RichMediaService.getGroupFileList(2)` | | 已接线，未验收 |
| `delete_group_file` | `RichMediaService.deleteGroupFile(3)` | | 已接线，未验收 |
| `get_group_file_system_info` | `RichMediaService.getGroupSpace(1)` | 总空间/已用 | 已接线，未验收 |
| `get_group_file_url` | — | 内核文件模型不保证返回 URL | 未支持 |

## 公告、精华

| OneBot 动作 | 内核方法 | 说明 | 状态 |
| --- | --- | --- | --- |
| `get_group_notice` / `_get_group_notice` | `GroupService.getGroupBulletin(1)` | | 已接线，未验收 |
| `_send_group_notice` / `send_group_notice` | `GroupService.publishGroupBulletin(3)` | 只发文本；图片参数未处理 | 已接线，未验收 |
| `_del_group_notice` / `delete_group_notice` | `GroupService.deleteGroupBulletin(3)` | | 已接线，未验收 |
| `get_essence_msg_list` | `GroupService.fetchGroupEssenceListV2(1)`，回退 `fetchGroupEssenceList(2)` | | 已接线，未验收 |
| `set_essence_msg` | `GroupService.addGroupEssence(1)` | | 已接线，未验收 |
| `delete_essence_msg` | `GroupService.removeGroupEssence(1)` | | 已接线，未验收 |

## 事件

| OneBot 事件 | 内核回调 | 说明 | 状态 |
| --- | --- | --- | --- |
| `notice.group_recall` / `notice.friend_recall` | `MsgService.onMsgRecall` | 原生消息键 → OneBot int32，发送者从本地缓存补 | 已接线，未验收 |
| `request.friend` | `BuddyService.onBuddyReqChange` | | 已接线，未验收 |
| `request.group` | `GroupService.onGroupSingleScreenNotifies(V2)` / `onGroupNotifiesUpdated(V2)` | 同一通知去重 | 已接线，未验收 |
| `notice.group_admin` | `GroupService.onGroupMemberRoleChanged` | | 已接线，未验收 |
| `notice.group_ban` | `GroupService.onShutUpMemberListChanged` | | 已接线，未验收 |
| `notice.group_increase` | `GroupService.onJoinGroupNotify` | | 已接线，未验收 |
| `notice.group_upload` | `GroupService.onGroupFileInfoAdd` | | 已接线，未验收 |
| `notice.notify.poke` | 消息 gray-tip / nudge 元素 | 纯系统灰条不上报为消息 | 已接线，未验收 |
| `notice.group_decrease` | — | 没有稳定增量回调 | 未支持 |
| `notice.friend_add` | — | 好友列表变更无可靠增量语义 | 未支持 |
| `meta_event.*` | — | 本地生成 | 已接线 |

## 内核里有、但没有接的能力

这些方法在当前 `wrapper.node` 中存在，但 OneBot v11 没有对应语义，或参数结构无法在不登录的情况下确认：

| 内核方法 | 为什么没接 |
| --- | --- |
| `MsgService.forwardMsg(4)` / `multiForwardMsg(3)` / `prepareForward(1)` | 需要构造原生转发节点，字段没有可验证契约；不伪造 |
| `MsgService.setMsgEmojiLikes(5)` / `getMsgEmojiLikesList(7)` | 表情回应，参数语义未验证 |
| `MsgService.getSourceOfReplyMsg(3)` / `replyMsgWithSourceMsgInfo(3)` | 回复细节；现有 reply 段已够用 |
| `GroupService.inviteMembersToGroup(2)` / `inviteMembersToGroupWithMsg(3)` | 邀请好友入群，未验证 |
| `GroupService.joinGroup(1)` / `reqToJoinGroup(1)` | 主动加群，风险高且非标准动作 |
| `GroupService.transferGroup(3)` | 转让群，误操作代价高 |
| `GroupService.createGroup(1)` / `destroyGroupV2(1)` | 建群/解散，非标准动作 |
| `GroupService.getGroupHonorList` 的更多 type | 语义未确认，目前原样透传 |
| `RichMediaService.onlyUploadFile(2)` / `uploadRMFileWithoutMsg(1)` | 文件发送改走 `sendMsg` + `fileElement` |
| `BuddyService.setBlock(2)` / `getAddFriendBlockedList(2)` | OneBot 无黑名单标准动作 |
| `ProfileService.getStatusInfo(2)` / `getSelfStatus(0)` | 在线状态，OneBot 无标准字段 |
| `AvatarService.*` | OneBot 不提供头像动作 |
| `GroupService.getGroupPortrait(1)` | 群头像，同上 |
| `GroupService.getGroupEssenceList` 之外的分页/置顶接口 | 现有列表够用 |

## 兼容性策略

1. **参数个数固定**：严格按内核断言的参数个数调用，不传多余参数。
2. **对象形状回退**：查询与幂等设置会尝试 2–3 种已知对象字段（如 `memberUin` / `uin`），因为不同内核版本的 JS 绑定松紧不同。
3. **变更不重试**：发送、撤回、踢人、禁言等只调用一次。取消或超时返回 `1502`，结果视为未知。
4. **显式失败**：内核拒绝、参数不符或方法不存在时返回 `1500` / `1404`，不会把失败包装成成功。
