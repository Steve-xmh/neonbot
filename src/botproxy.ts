import { EventEmitter } from 'events'
import { MessagePort, parentPort } from 'worker_threads'
import { messages } from './messages'
import * as oicq from 'oicq'
import { PluginInfos } from './plugin'
import { logger } from '.'
import { GFSProxy } from './gfsproxy'

export const accpetableMethods = [
    'login',
    'captchaLogin',
    'sliderLogin',
    'terminate',
    'logout',
    'isOnline',
    'sendSMSCode',
    'submitSMSCode',
    'setOnlineStatus',
    'getFriendList',
    'getStrangerList',
    'getGroupList',
    'getGroupMemberList',
    'getStrangerInfo',
    'getGroupInfo',
    'getGroupMemberInfo',
    'sendPrivateMsg',
    'sendGroupMsg',
    'sendTempMsg',
    'sendDiscussMsg',
    'deleteMsg',
    'getMsg',
    'getChatHistory',
    'getForwardMsg',
    'sendGroupNotice',
    'setGroupName',
    'setGroupAnonymous',
    'setGroupWholeBan',
    'setGroupAdmin',
    'setGroupSpecialTitle',
    'setGroupCard',
    'setGroupKick',
    'setGroupBan',
    'setGroupAnonymousBan',
    'setGroupLeave',
    'sendGroupPoke',
    'setFriendAddRequest',
    'setGroupAddRequest',
    'getSystemMsg',
    'addGroup',
    'addFriend',
    'deleteFriend',
    'inviteFriend',
    'sendLike',
    'setNickname',
    'setGender',
    'setBirthday',
    'setDescription',
    'setSignature',
    'setPortrait',
    'setGroupPortrait',
    'getFile',
    'preloadImages',
    'getRoamingStamp',
    'getGroupNotice',
    'getCookies',
    'getCsrfToken',
    'cleanCache',
    'canSendImage',
    'canSendRecord',
    'acquireGfs',
    'getVersionInfo',
    'getStatus',
    'getLoginInfo',
    'reloadFriendList',
    'reloadGroupList'
]

export const accpetableEvents = [
    'system.login.captcha',
    'system.login.slider',
    'system.login.device',
    'system.login.error',
    'system.login',
    'system.online',
    'system.offline',
    'system.offline.network',
    'system.offline.kickoff',
    'system.offline.frozen',
    'system.offline.device',
    'system.offline.unknown',
    'system',
    'message.private.friend',
    'message.private.single',
    'message.private.group',
    'message.private.other',
    'message.private',
    'message.group.normal',
    'message.group.anonymous',
    'message.group.discuss',
    'message.group',
    'message.discuss',
    'message',
    'request.friend.add',
    'request.friend',
    'request.group.add',
    'request.group.invite',
    'request.group',
    'request',
    'notice.friend.increase',
    'notice.friend.decrease',
    'notice.friend.recall',
    'notice.friend.profile',
    'notice.friend.poke',
    'notice.group.increase',
    'notice.group.decrease',
    'notice.group.recall',
    'notice.group.admin',
    'notice.group.ban',
    'notice.group.transfer',
    'notice.group.title',
    'notice.group.poke',
    'notice.group.setting',
    'notice.friend',
    'notice.group',
    'notice'
]

export class BotProxyError extends Error { }

/**
 * 在机器人线程里运行的代理机器人，将会转换 oicq 的各类方法调用及事件触发并发送至主线程处理
 *
 * 介于需要跨线程调用，所以此处所有的函数都是异步的
 */
export class BotProxy extends EventEmitter {
    private awaitingPromises = new Map<string, [(result: any) => void, (reason: any) => void]>()
    private channelClosed = false
    private readonly firstSync = Symbol('first-sync')

    private firstSynced = false

    // 通过 MessagePort 初始化传入数据 + 监听事件来获取更新

    uin = 0
    // eslint-disable-next-line camelcase
    password_md5 = Buffer.alloc(0)
    passwordMd5 = Buffer.alloc(0)

    nickname = ''
    sex: oicq.Gender = 'unknown'
    age = 0;

    /** 日志记录器 */
    logger = logger

    /** 在线状态 */
    // eslint-disable-next-line camelcase
    online_status = 0
    /** 在线状态 */
    onlineStatus = 0

    /** 好友列表 */
    fl = new Map<number, oicq.FriendInfo>()
    /**
     * 陌生人列表
     *
     * 该属性并非完全同步，请改用 `BotProxy.getStrangerList`
     */
    sl = new Map<number, oicq.StrangerInfo>()
    /** 群列表 */
    gl = new Map<number, oicq.GroupInfo>()

    gml = new Map<number, Map<number, oicq.MemberInfo>>()

    /** 当前账号本地存储路径 */
    dir = ''

    /** 该属性并非完全同步，请改用 `BotProxy.getStatus` */
    stat: oicq.Statistics = {
        start_time: 0,
        lost_times: 0,
        recv_pkt_cnt: 0,
        sent_pkt_cnt: 0,
        lost_pkt_cnt: 0,
        recv_msg_cnt: 0,
        sent_msg_cnt: 0
    }

    /** 配置信息，目前不可进行热修改 */
    config: oicq.ConfBot = {}

    constructor (public readonly qqid: number, private readonly port: MessagePort) {
        super()
        this.uin = qqid
        process.once('uncaughtException', () => {
            this.close() // 出错时关闭通讯接口
        })
        this.port.once('close', () => {
            this.channelClosed = true
        })
        const messageCallback = (data: messages.BaseMessage) => {
            logger.debug(data)
            if (this.awaitingPromises.has(data.id)) {
                const result = data as unknown as messages.BaseResult
                const [resolve, reject] = this.awaitingPromises.get(data.id)!!
                this.awaitingPromises.delete(data.id)
                if (result.succeed) {
                    resolve(result.value)
                } else {
                    reject(result.value)
                }
            } else if (data.type === 'node-oicq-event') {
                if (this.firstSynced) {
                    this.collectEventAndEmit(data)
                } else {
                    this.once(this.firstSync, this.collectEventAndEmit.bind(this, data))
                }
            } else if (data.type === 'node-oicq-sync') {
                const syncData = (data as messages.NodeOICQSyncMessage).value
                this.passwordMd5 = this.password_md5 = Buffer.from(syncData.password_md5)
                this.onlineStatus = this.online_status = syncData.online_status
                this.nickname = syncData.nickname
                this.sex = syncData.sex
                this.uin = syncData.uin
                this.fl = syncData.fl
                this.sl = syncData.sl
                this.gl = syncData.gl
                this.gml = syncData.gml
                this.dir = syncData.dir
                this.config = syncData.config
                this.stat = syncData.stat
                if (!this.firstSynced) {
                    this.firstSynced = true
                    this.emit(this.firstSync)
                }
                logger.info('Synced Data', this)
            } else {
                logger.warn('接收到未知的代理机器人消息：', data)
            }
        }
        parentPort?.on('message', messageCallback)
        this.port.on('message', messageCallback)
    }

    private collectEventAndEmit (data: messages.BaseMessage) {
        const evt = (data as messages.NodeOICQEventMessage).value
        // 同步属性
        switch (evt.eventName) {
        case 'system.online':
            this.getStatus()
            break
        case 'system.offline':
            this.onlineStatus = this.online_status = 0
            break
        case 'notice.friend.increase':
            this.getFriendList()
            break
        case 'notice.friend.decrease':
            this.fl.delete((evt as any).user_id)
            break
        case 'notice.group.increase':
            this.getGroupMemberInfo((evt as any).group_id, (evt as any).user_id)
            break
        case 'notice.group.decrease':
        {
            const gms = this.gml.get((evt as any).group_id)
            if (gms) {
                gms.delete((evt as any).user_id)
            }
            break
        }
        }
        if (evt.eventName.startsWith('message')) {
            if (evt.message_type === 'group') {
                evt.reply = (message: any, autoEscape = false) => this.sendGroupMsg((evt as any).group_id, message, autoEscape)
            } else {
                evt.reply = (message: any, autoEscape = false) => this.sendPrivateMsg((evt as any).user_id, message, autoEscape)
            }
        }
        this.emit(evt.eventName, evt)
    }

    /**
     * 向机器人线程发送调用消息，并等待返回数据
     * **不建议直接调用此函数，使用其他包装函数**
     * @param type 通讯消息类型
     * @param value 需要传递的数据
     * @returns 根据消息类型所传回的实际数据
     */
    invoke (type: messages.EventNames, value?: any): Promise<any> {
        if (this.channelClosed) {
            return Promise.reject(new BotProxyError('通信接口已经关闭'))
        } else if (this.firstSynced) {
            return new Promise((resolve, reject) => {
                const msg = messages.makeMessage(type, value)
                this.awaitingPromises.set(msg.id, [resolve, reject])
                this.port.postMessage(msg)
            })
        } else {
            return new Promise((resolve, reject) => {
                this.once(this.firstSync, () => {
                    const msg = messages.makeMessage(type, value)
                    this.awaitingPromises.set(msg.id, [resolve, reject])
                    this.port.postMessage(msg)
                })
            })
        }
    }

    /**
     * 向宿主线程发送调用消息，并等待返回数据
     * @param type 通讯消息类型
     * @param value 需要传递的数据
     * @returns 根据消息类型所传回的实际数据
     */
    private invokeParentPort (type: messages.EventNames, value?: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!parentPort) {
                return reject(new BotProxyError('通信接口已经关闭'))
            } else {
                const msg = messages.makeMessage(type, value)
                this.awaitingPromises.set(msg.id, [resolve, reject])
                parentPort.postMessage(msg)
            }
        })
    }

    /** 获取可用的插件列表 */
    getListPlugin () {
        return this.invokeParentPort('list-plugins') as Promise<PluginInfos>
    }

    /** 对机器人启用插件 */
    enablePlugin (pluginId: string) {
        return this.invokeParentPort('enable-plugin', {
            qqId: this.qqid,
            pluginId
        }) as Promise<void>
    }

    /** 禁用插件 */
    disablePlugin (pluginId: string) {
        return this.invokeParentPort('disable-plugin', {
            qqId: this.qqid,
            pluginId
        }) as Promise<void>
    }

    /** 重载插件 */
    reloadPlugin (pluginId: string) {
        return this.invokeParentPort('reload-plugin', {
            qqId: this.qqid,
            pluginId
        }) as Promise<void>
    }

    // Node-OICQ 自带的函数，已全部异步化

    /**
     * 登录机器人账户
     *
     * 由于 NeonBot 会自动管理登录状态，所以除非你知道你在做什么，否则**不要调用此方法**
     * @param password 明文或md5后的密码，重复调用时可无需传入此参数
     */
    login (password?: Uint8Array | string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'login',
            arguments: [password]
        }) as Promise<void>
    }

    /**
     * 提交滑动验证码ticket
     *
     * 由于 NeonBot 会自动管理登录状态，所以除非你知道你在做什么，否则**不要调用此方法**
     */
    sliderLogin (ticket: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sliderLogin',
            arguments: [ticket]
        }) as Promise<void>
    }

    /**
     * 先下线再关闭连接
     *
     * 由于 NeonBot 会自动管理登录状态，所以除非你知道你在做什么，否则**不要调用此方法**
     */
    logout () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'logout'
        }) as Promise<void>
    }

    isOnline () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'isOnline'
        }) as Promise<boolean>
    }

    /**
     * 发验证码给密保手机，用于发短信过设备锁
     *
     * 由于 NeonBot 会自动管理登录状态，所以除非你知道你在做什么，否则**不要调用此方法**
     */
    sendSMSCode () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendSMSCode'
        }) as Promise<void>
    }

    /**
     * 提交收到的短信验证码
     */
    submitSMSCode (code: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'submitSMSCode',
            arguments: [code]
        }) as Promise<void>
    }

    /**
     * 设置在线状态
     */
    setOnlineStatus (status: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setOnlineStatus',
            arguments: [status]
        }).then((v: oicq.Ret) => {
            if (!v.error) {
                this.online_status = this.onlineStatus = status
            }
        }) as Promise<oicq.Ret>
    }

    /**
     * 获取好友列表
     *
     * 此方法在 oicq 是弃用的，但是 NeonBot 出于跨线程异步化的想法依然保留此方法，其行为和直接访问 this.fl 一致
     */
    async getFriendList () {
        const v = await this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getFriendList'
        })
        if (!v.error && v.data) {
            this.fl = v.data
        }
        return v
    }

    /**
     * 获取陌生人列表
     *
     * 此方法在 oicq 是弃用的，但是 NeonBot 出于跨线程异步化的想法依然保留此方法，其行为和直接访问 this.sl 一致
     */
    getStrangerList () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getStrangerList'
        }) as Promise<oicq.Ret<Map<number, oicq.StrangerInfo>>>
    }

    /**
     * 获取群列表
     *
     * 此方法在 oicq 是弃用的，但是 NeonBot 出于跨线程异步化的想法依然保留此方法，其行为和直接访问 this.gl 一致
     */
    getGroupList () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getGroupList'
        }) as Promise<oicq.Ret<Map<number, oicq.GroupInfo>>>
    }

    /**
     * 获取群成员列表
     */
    async getGroupMemberList (groupId: number, noCache?: boolean) {
        const v = await this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getGroupMemberList',
            arguments: [groupId, noCache]
        })
        if (!v.error && v.data) {
            this.gml.set(groupId, v.data)
        }
        return v
    }

    /**
     * 获取陌生人资料
     */
    getStrangerInfo (userId: number, noCache?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getStrangerInfo',
            arguments: [userId, noCache]
        }) as Promise<oicq.Ret<oicq.StrangerInfo>>
    }

    /**
     * 获取群资料
     */
    getGroupInfo (groupId: number, noCache?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getGroupInfo',
            arguments: [groupId, noCache]
        }) as Promise<oicq.Ret<oicq.GroupInfo>>
    }

    /**
     * 获取群员资料
     */
    async getGroupMemberInfo (groupId: number, userId: number, noCache?: boolean) {
        const v = await this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getGroupMemberInfo',
            arguments: [groupId, userId, noCache]
        })
        if (!v.error && v.data) {
            const gms = this.gml.get(v.data.group_id)
            if (gms) {
                gms.set(v.data.user_id, v.data)
            } else {
                this.getGroupMemberList(v.data.group_id)
            }
        }
        return v
    }

    /**
     * 私聊
     */
    sendPrivateMsg (userId: number, message: oicq.MessageElem | Iterable<oicq.MessageElem> | string, autoEscape?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendPrivateMsg',
            arguments: [userId, message, autoEscape]
            // eslint-disable-next-line camelcase
        }) as Promise<oicq.Ret<{ message_id: string }>>
    }

    /**
     * 群聊
     */
    sendGroupMsg (groupId: number, message: oicq.MessageElem | Iterable<oicq.MessageElem> | string, autoEscape?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendGroupMsg',
            arguments: [groupId, message, autoEscape]
            // eslint-disable-next-line camelcase
        }) as Promise<oicq.Ret<{ message_id: string }>>
    }

    /**
     * 群临时会话，大多数时候可以使用私聊达到同样效果
     */
    sendTempMsg (groupId: number, userId: number, message: oicq.MessageElem | Iterable<oicq.MessageElem> | string, autoEscape?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendTempMsg',
            arguments: [groupId, userId, message, autoEscape]
            // eslint-disable-next-line camelcase
        }) as Promise<oicq.Ret<{ message_id: string }>>
    }

    /**
     * 讨论组
     */
    sendDiscussMsg (discussId: number, message: oicq.MessageElem | Iterable<oicq.MessageElem> | string, autoEscape?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendDiscussMsg',
            arguments: [discussId, message, autoEscape]
            // eslint-disable-next-line camelcase
        }) as Promise<oicq.Ret<{ message_id: string }>>
    }

    /**
     * 撤回
     */
    deleteMsg (messageId: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'deleteMsg',
            arguments: [messageId]
        }) as Promise<oicq.Ret>
    }

    /**
     * 获取一条消息(无法获取被撤回的消息)
     */
    getMsg (messageId: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getMsg',
            arguments: [messageId]
        }) as Promise<oicq.Ret<oicq.PrivateMessageEventData | oicq.GroupMessageEventData>>
    }

    /**
     * 获取message_id往前的count条消息(包括自身)
     * 无法获取被撤回的消息，因此返回的数量并不一定为count
     * count默认为20，不能超过20
     *
     * 若要获取最新的20条消息，参考https://github.com/takayama-lily/oicq/wiki/93.%E8%A7%A3%E6%9E%90%E6%B6%88%E6%81%AFID
     * 自行构造消息id，除群号外其余位补0
     */
    getChatHistory (messageId: string, count?: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getChatHistory',
            arguments: [messageId, count]
        }) as Promise<oicq.Ret<oicq.PrivateMessageEventData[] | oicq.GroupMessageEventData[]>>
    }

    /**
     * 获取转发消息
     * resid在xml消息中，需要自行解析xml获得
     * 暂不支持套娃转发解析
     */
    getForwardMsg (resid: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getForwardMsg',
            arguments: [resid]
        }) as Promise<oicq.Ret<{
            // eslint-disable-next-line camelcase
            group_id?: number,
            // eslint-disable-next-line camelcase
            user_id: number,
            nickname: number,
            time: number,
            message: oicq.MessageElem[],
            // eslint-disable-next-line camelcase
            raw_message: string,
        }[]>>
    }

    /**
     * 发群公告
     */
    sendGroupNotice (groupId: number, content: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendGroupNotice',
            arguments: [groupId, content]
        }) as Promise<oicq.Ret>
    }

    /**
     * 设置群名
     */
    setGroupName (groupId: number, groupName: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupName',
            arguments: [groupId, groupName]
        }) as Promise<oicq.Ret>
    }

    /**
     * 开启或关闭匿名
     */
    setGroupAnonymous (groupId: number, enable?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupAnonymous',
            arguments: [groupId, enable]
        }) as Promise<oicq.Ret>
    }

    /**
     * 全员禁言
     */
    setGroupWholeBan (groupId: number, enable?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupWholeBan',
            arguments: [groupId, enable]
        }) as Promise<oicq.Ret>
    }

    /**
     * 设置管理员
     */
    setGroupAdmin (groupId: number, userId: number, enable?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupAdmin',
            arguments: [groupId, userId, enable]
        }) as Promise<oicq.Ret>
    }

    /**
     * 设置群头衔
     */
    setGroupSpecialTitle (groupId: number, userId: number, specialTitle?: string, duration?: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupSpecialTitle',
            arguments: [groupId, userId, specialTitle, duration]
        }) as Promise<oicq.Ret>
    }

    /**
     * 设置群名片
     */
    setGroupCard (groupId: number, userId: number, card?: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupCard',
            arguments: [groupId, userId, card]
        }) as Promise<oicq.Ret>
    }

    /**
     * 踢人(不支持批量)
     */
    setGroupKick (groupId: number, userId: number, rejectAddRequest?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupKick',
            arguments: [groupId, userId, rejectAddRequest]
        }) as Promise<oicq.Ret>
    }

    /**
     * 禁言
     */
    setGroupBan (groupId: number, userId: number, duration?: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupBan',
            arguments: [groupId, userId, duration]
        }) as Promise<oicq.Ret>
    }

    /**
     * 禁言匿名玩家
     */
    setGroupAnonymousBan (groupId: number, flag: string, duration?: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupAnonymousBan',
            arguments: [groupId, flag, duration]
        }) as Promise<oicq.Ret>
    }

    /**
     * 退群
     */
    setGroupLeave (groupId: number, isDismiss?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupLeave',
            arguments: [groupId, isDismiss]
        }) as Promise<oicq.Ret>
    }

    /**
     * 戳一戳
     */
    sendGroupPoke (groupId: number, userId: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendGroupPoke',
            arguments: [groupId, userId]
        }) as Promise<oicq.Ret>
    }

    /**
     * 处理好友请求
     */
    setFriendAddRequest (flag: string, approve?: boolean, remark?: string, block?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setFriendAddRequest',
            arguments: [flag, approve, remark, block]
        }) as Promise<oicq.Ret>
    }

    /**
     * 处理群请求
     */
    setGroupAddRequest (flag: string, approve?: boolean, reason?: string, block?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupAddRequest',
            arguments: [flag, approve, reason, block]
        }) as Promise<oicq.Ret>
    }

    /**
     * 获取未处理的请求
     */
    getSystemMsg () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getSystemMsg'
        }) as Promise<oicq.Ret<(oicq.FriendAddEventData | oicq.GroupAddEventData | oicq.GroupInviteEventData)[]>>
    }

    /**
     * 该接口风控
     */
    addGroup (groupId: number, comment?: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'addGroup',
            arguments: [groupId, comment]
        }) as Promise<oicq.Ret>
    }

    /**
     * 该接口风控(只能添加群员)
     */
    addFriend (groupId: number, userId: number, comment?: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'addFriend',
            arguments: [groupId, userId, comment]
        }) as Promise<oicq.Ret>
    }

    /**
     * 删除好友
     */
    deleteFriend (userId: number, block?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'deleteFriend',
            arguments: [userId, block]
        }) as Promise<oicq.Ret>
    }

    /**
     * 邀请好友入群(不支持陌生人和批量)
     */
    inviteFriend (groupId: number, userId: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'inviteFriend',
            arguments: [groupId, userId]
        }) as Promise<oicq.Ret>
    }

    /**
     * 点赞(times默认1，不支持陌生人)
     */
    sendLike (userId: number, times?: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendLike',
            arguments: [userId, times]
        }) as Promise<oicq.Ret>
    }

    /**
     * 设置昵称
     */
    async setNickname (nickname: string) {
        const v = await this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setNickname',
            arguments: [nickname]
        })
        if (!v.error) {
            this.nickname = nickname
        }
        return v
    }

    /**
     * 设置性别(0未知 1男 2女)
     */
    async setGender (gender: 0 | 1 | 2) {
        const v = await this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGender',
            arguments: [gender]
        })
        if (!v.error) {
            this.sex = [
                'unknown',
                'male',
                'female'
            ][gender] as oicq.Gender
        }
        return v
    }

    /**
     * 设置生日(20110202的形式)
     */
    async setBirthday (birthday: string | number) {
        const v = await this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setBirthday',
            arguments: [birthday]
        })
        if (!v.error) {
            const birth = String(birthday)
            const year = birth.substring(0, 4)
            const mouth = birth.substring(4, 6)
            const day = birth.substring(6, 8)
            const birthDate = new Date(`${year}-${mouth}-${day} 00:00`)
            const today = new Date()
            const age = today.getFullYear() - birthDate.getFullYear()
            const m = today.getMonth() - birthDate.getMonth()
            if (m > 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                return age - 1
            } else {
                return age
            }
        }
        return v
    }

    /**
     * 设置个人说明
     */
    setDescription (description?: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setDescription',
            arguments: [description]
        }) as Promise<oicq.Ret>
    }

    /**
     * 设置个人签名
     */
    setSignature (signature?: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setSignature',
            arguments: [signature]
        }) as Promise<oicq.Ret>
    }

    /**
     * 设置个人头像
     */
    setPortrait (file: oicq.MediaFile) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setPortrait',
            arguments: [file]
        }) as Promise<oicq.Ret>
    }

    /**
     * 设置群头像
     */
    setGroupPortrait (groupId: number, file: oicq.MediaFile) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupPortrait',
            arguments: [groupId, file]
        }) as Promise<oicq.Ret>
    }

    /**
     * 预先上传图片以备发送
     * 通常图片在发送时一并上传
     * 提前上传可用于加快发送速度，实现秒发
     */
    preloadImages (files: Iterable<oicq.MediaFile>) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'preloadImages',
            arguments: [files]
        }) as Promise<oicq.Ret<string[]>>
    }

    /**
     * 获取漫游表情
     */
    getRoamingStamp (noCache?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getRoamingStamp',
            arguments: [noCache]
        }) as Promise<oicq.Ret<string[]>>
    }

    /**
     * 获取群公告
     */
    getGroupNotice (groupId: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getGroupNotice',
            arguments: [groupId]
        }) as Promise<oicq.Ret<{
            u: number, // 发布者
            fid: string,
            pubt: number, // 发布时间
            msg: {
                text: string,
                title: string,
                pics?: Array<{
                    id: string,
                    w: string,
                    h: string,
                }>,
            },
            type: number,
            settings: {
                // eslint-disable-next-line camelcase
                is_show_edit_card: number,
                // eslint-disable-next-line camelcase
                remind_ts: number,
                // eslint-disable-next-line camelcase
                tip_window_type: number,
                // eslint-disable-next-line camelcase
                confirm_required: number
            },
            // eslint-disable-next-line camelcase
            read_num: number,
            // eslint-disable-next-line camelcase
            is_read: number,
            // eslint-disable-next-line camelcase
            is_all_confirm: number
        }[]>>
    }

    /**
     * 支持的域名：
     * tenpay.com | docs.qq.com | office.qq.com | connect.qq.com
     * vip.qq.com | mail.qq.com | qzone.qq.com | gamecenter.qq.com
     * mma.qq.com | game.qq.com | qqweb.qq.com | openmobile.qq.com
     * qun.qq.com | ti.qq.com |
     */
    getCookies (domain?: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getCookies',
            arguments: [domain]
        }) as Promise<oicq.Ret<{ cookies: string }>>
    }

    getCsrfToken () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getCsrfToken'
        }) as Promise<oicq.Ret<{ token: number }>>
    }

    /**
     * 清除 image 和 record 文件夹下的缓存文件
     */
    cleanCache (type?: 'image' | 'record') {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'cleanCache',
            arguments: [type]
        }) as Promise<oicq.Ret>
    }

    /**
     * 获取在线状态和数据统计
     */
    async getStatus () {
        const v = await this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getStatus'
        })
        if (!v.error && v.data) {
            this.onlineStatus = this.online_status = v.data.status
            this.stat = v.data.statistics
        }
        return v
    }

    /**
     * 获取登录账号信息
     */
    getLoginInfo () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getLoginInfo'
        }) as Promise<oicq.Ret<oicq.LoginInfo>>
    }

    /**
     * 获取等级信息(默认获取自己的)
     */
    getLevelInfo (userId?: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getLevelInfo',
            arguments: [userId]
        }) as Promise<oicq.Ret<any>>
    }

    /**
     * 进入群文件系统
     */
    acquireGfs (groupId: number) {
        return new GFSProxy(groupId, (this.invoke('node-oicq-gfs-aquire', {
            groupId
        }) as Promise<{
            port: MessagePort
        }>).then(v => v.port))
    }

    /**
     * 重载好友列表
     * 完成之前无法调用任何api，也不会上报任何事件
     */
    reloadFriendList () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'reloadFriendList'
        }) as Promise<oicq.Ret>
    }

    /**
     * 重载群列表
     * 完成之前无法调用任何api，也不会上报任何事件
     */
    reloadGroupList () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'reloadGroupList'
        }) as Promise<oicq.Ret>
    }

    /** @deprecated 直接关闭连接 */
    terminate () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'terminate'
        }) as Promise<void>
    }

    /** @deprecated 文字验证码 */
    captchaLogin (captcha: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'captchaLogin',
            arguments: [captcha]
        }) as Promise<void>
    }

    /** @deprecated */
    canSendImage () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'canSendImage'
        }) as Promise<oicq.Ret<boolean>>
    }

    /** @deprecated */
    canSendRecord () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'canSendRecord'
        }) as Promise<oicq.Ret<boolean>>
    }

    /** @deprecated 获取版本信息(暂时为返回package.json中的信息) */
    getVersionInfo () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getVersionInfo'
        }) as Promise<oicq.Ret<typeof import('oicq/package.json')>>
    }

    /**
     * 释放对象，关闭通讯接口
     * `BotProxy` 的通讯一般由 NeonBot 自行管理，插件无需调用此函数
     */
    close () {
        this.port.close()
    }
}
