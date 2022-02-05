import { EventEmitter } from 'events'
import { MessagePort, parentPort } from 'worker_threads'
import { messages } from './messages'
import * as oicq from 'oicq'
import { PluginInfos } from './plugin'
import { logger } from '.'
import { GFSProxy } from './gfsproxy'
import { randomBytes } from 'crypto'
import { restoreObject } from './utils'
import * as path from 'path'

export const acceptableMethods: Set<keyof oicq.Client> = new Set([
    'acquireGfs',
    'addFriend',
    'cleanCache',
    'deleteFriend',
    'deleteMsg',
    'em',
    'getChatHistory',
    'getCookies',
    'getCsrfToken',
    'getForwardMsg',
    'getFriendList',
    'getGroupInfo',
    'getGroupList',
    'getGroupMemberInfo',
    'getGroupMemberList',
    'getMsg',
    'getRoamingStamp',
    'getStrangerInfo',
    'getStrangerList',
    'getSystemMsg',
    'inviteFriend',
    'isOnline',
    'login',
    'logout',
    'reloadFriendList',
    'reloadGroupList',
    'reportReaded',
    'sendDiscussMsg',
    'sendGroupMsg',
    'sendGroupNotice',
    'sendGroupPoke',
    'sendLike',
    'sendOidb',
    'sendPrivateMsg',
    'sendSMSCode',
    'sendTempMsg',
    'sendUni',
    'setBirthday',
    'setDescription',
    'setFriendAddRequest',
    'setGender',
    'setGroupAddRequest',
    'setGroupAdmin',
    'setGroupAnonymous',
    'setGroupAnonymousBan',
    'setGroupBan',
    'setGroupCard',
    'setGroupKick',
    'setGroupLeave',
    'setGroupName',
    'setGroupPortrait',
    'setGroupSpecialTitle',
    'setGroupWholeBan',
    'setNickname',
    'setOnlineStatus',
    'setPortrait',
    'setSignature',
    'sliderLogin',
    'submitSMSCode',
    'terminate'
])

export const acceptableEvents: Set<keyof oicq.EventMap> = new Set([
    'internal.input',
    'internal.sso',
    'message',
    'message.discuss',
    'message.group',
    'message.group.anonymous',
    'message.group.normal',
    'message.private',
    'message.private.friend',
    'message.private.group',
    'message.private.other',
    'message.private.self',
    'notice',
    'notice.friend',
    'notice.friend.decrease',
    'notice.friend.increase',
    'notice.friend.poke',
    'notice.friend.recall',
    'notice.group',
    'notice.group.admin',
    'notice.group.ban',
    'notice.group.decrease',
    'notice.group.increase',
    'notice.group.poke',
    'notice.group.recall',
    'notice.group.transfer',
    'request',
    'request.friend',
    'request.friend.add',
    'request.friend.single',
    'request.group',
    'request.group.add',
    'request.group.invite'
])

export class BotProxyError extends Error { }

/**
 * 在机器人线程里运行的代理机器人，将会转换 oicq 的各类方法调用及事件触发并发送至主线程处理
 *
 * 介于需要跨线程调用，所以此处几乎所有的函数都是异步的
 */
export class BotProxy extends EventEmitter {
    private awaitingPromises = new Map<string, [(result: any) => void, (reason: any) => void]>()
    private channelClosed = false
    private readonly firstSync = Symbol('first-sync')

    private firstSynced = false

    // 通过 MessagePort 初始化传入数据 + 监听事件来获取更新

    uin: oicq.Client['uin'] = 0
    // eslint-disable-next-line camelcase
    password_md5: oicq.Client['password_md5'] = Buffer.alloc(0)
    passwordMd5: oicq.Client['password_md5'] = Buffer.alloc(0)

    online = false
    nickname: oicq.Client['nickname'] = ''
    sex: oicq.Client['sex'] = 'unknown'
    age: oicq.Client['age'] = 0

    /** 日志记录器 */
    logger = logger

    /** 在线状态 */
    status: oicq.Client['status'] = oicq.OnlineStatus.Online

    /** 好友列表 */
    fl: oicq.Client['fl'] = new Map<number, oicq.FriendInfo>()
    /**
     * 陌生人列表
     *
     * 该属性并非完全同步，请改用 `BotProxy.getStrangerList`
     */
    sl: oicq.Client['sl'] = new Map()
    /** 群列表 */
    gl: oicq.Client['gl'] = new Map()
    /** 群成员列表 */
    gml: oicq.Client['gml'] = new Map()

    /**
     * 黑名单列表
     */
    blacklist = new Set<number>()

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
        sent_msg_cnt: 0,
        msg_cnt_per_min: 0,
        remote_ip: '',
        remote_port: 0
    }

    /** 配置信息，目前不可进行热修改 */
    config: Required<oicq.Config> = {
        log_level: 'info',
        platform: 1,
        auto_server: true,
        ignore_self: true,
        resend: true,
        cache_group_member: true,
        reconn_interval: 5,
        data_dir: path.join(require?.main?.path || process.cwd(), 'data'),
        ffmpeg_path: '',
        ffprobe_path: ''
    }

    /** 是否在消息前缀加入无意义的随机 [mirai:data={ran:123456}] 消息，可解决消息重复发送导致的消息无法看见的问题 */
    randomHashedMessage = false

    constructor (public readonly qqid: number, private port: MessagePort, private pluginId: string) {
        super()
        logger.debug('创建了新机器人代理对象', qqid, port)
        this.uin = qqid
        this.port.once('messageerror', (err) => {
            logger.warn('警告：通信接口发生错误', err)
        })
        this.port.once('close', () => {
            logger.debug('警告：通信接口已关闭')
            this.channelClosed = true
        })
        const messageCallback = (rawdata: messages.BaseMessage) => {
            const data = restoreObject(rawdata)
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
                this.status = syncData.status
                this.nickname = syncData.nickname
                this.online = syncData.online
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
                logger.debug('已同步机器人数据', syncData)
            } else if ([
                'disable-plugin'
            ].includes(data.type)) {
                // 在插件工作线程主事件处理器内处理
            } else {
                logger.warn('接收到未知的代理机器人消息：', data)
            }
        }
        parentPort?.on('message', messageCallback)
        this.port.on('message', messageCallback)
    }

    /**
     * 使用新的通信接口替换已有接口（重新连接）
     * 由 NeonBot 内部使用，用于和崩溃的机器人线程重新连接
     * @param newPort 新的通讯接口
     */
    reconnect (newPort: MessagePort) {
        this.port.close()
        this.port = newPort
    }

    private collectEventAndEmit (data: messages.BaseMessage) {
        const msg = data as messages.NodeOICQEventMessage
        const evt = msg.value
        // 同步属性
        switch (msg.eventName) {
        case 'system.online':
            this.online = true
            break
        case 'notice.friend.increase':
            this.getFriendList()
            break
        case 'notice.friend.decrease':
            this.fl.delete((evt as unknown as oicq.FriendDecreaseEvent).user_id)
            break
        case 'notice.group.increase':
            this.getGroupMemberInfo((evt as unknown as oicq.MemberIncreaseEvent).group_id, (evt as any).user_id)
            break
        case 'notice.group.decrease':
        {
            const gms = this.gml.get((evt as any).group_id)
            if (gms) {
                gms.delete((evt as unknown as oicq.MemberDecreaseEvent).user_id)
            }
            break
        }
        }
        const listeners = this.listeners(msg.eventName)
        logger.debug(listeners)
        this.emit(msg.eventName, evt)
    }

    /**
     * 当初始化完成之后（第一次同步事件触发时）返回
     */
    private whenReady (): Promise<void> {
        if (this.channelClosed) {
            return Promise.reject(new BotProxyError('通信接口已经关闭'))
        } else if (this.firstSynced) {
            return Promise.resolve()
        } else {
            return new Promise((resolve) => {
                this.once(this.firstSync, resolve)
            })
        }
    }

    /**
     * 向机器人线程发送调用消息，并等待返回数据
     * **不建议直接调用此函数，使用其他包装函数**
     * @param type 通讯消息类型
     * @param value 需要传递的数据
     * @returns 根据消息类型所传回的实际数据
     */
    async invoke<M extends keyof oicq.Client> (type: messages.EventNames, value?: messages.NodeOICQInvokeMessage<M>['value']): Promise<messages.ReturnTypeOfClientMethod<M>> {
        await this.whenReady()
        return await new Promise((resolve, reject) => {
            const msg = messages.makeMessage(type, value)
            this.awaitingPromises.set(msg.id, [resolve, reject])
            logger.debug('BotProxy -> MessagePort', msg)
            this.port.postMessage(msg)
        })
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
                logger.debug('BotProxy -> ParentPort', msg)
                parentPort.postMessage(msg)
            }
        })
    }

    /** 获取可用的插件列表 */
    getListPlugin () {
        return this.invokeParentPort('list-plugins') as Promise<PluginInfos>
    }

    /** 获取因出错而无法读取的插件错误输出 */
    listPluginErrorOutputs () {
        return this.invokeParentPort('list-plugin-error-outputs') as Promise<string[]>
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

    saveGlobalUserData (data: any) {
        return this.invokeParentPort('set-save-data', {
            data
        }) as Promise<void>
    }

    loadGlobalUserData<T = any> () {
        return this.invokeParentPort('get-save-data', {}) as Promise<T | undefined>
    }

    saveLocalUserData (data: any) {
        return this.invokeParentPort('set-save-data', {
            data,
            qqid: this.qqid
        }) as Promise<void>
    }

    loadLocalUserData<T = any> () {
        return this.invokeParentPort('get-save-data', { qqid: this.qqid }) as Promise<T | undefined>
    }

    // Node-OICQ 自带的函数，已全部异步化

    /**
     * 登录机器人账户
     *
     * 由于 NeonBot 会自动管理登录状态，所以除非你知道你在做什么，否则**不要调用此方法**
     * @param password 明文或md5后的密码，重复调用时可无需传入此参数
     */
    login (password?: Buffer | string) {
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
        })
    }

    /**
     * 先下线再关闭连接
     *
     * 由于 NeonBot 会自动管理登录状态，所以除非你知道你在做什么，否则**不要调用此方法**
     */
    logout (keepAlive?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'logout',
            arguments: [keepAlive]
        }) as Promise<void>
    }

    isOnline () {
        return this.online
    }

    /**
     * 发验证码给密保手机，用于发短信过设备锁
     *
     * 由于 NeonBot 会自动管理登录状态，所以除非你知道你在做什么，否则**不要调用此方法**
     */
    sendSMSCode () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendSMSCode',
            arguments: []
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
    setOnlineStatus (status?: oicq.OnlineStatus) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setOnlineStatus',
            arguments: [status]
        }).then((v: boolean) => {
            if (status) this.status = status
            return v
        })
    }

    /**
     * 获取好友列表
     *
     * 此方法在 oicq 是弃用的，但是 NeonBot 出于跨线程异步化的想法依然保留此方法，其行为和直接访问 this.fl 一致
     */
    async getFriendListAsync () {
        const v = await this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getFriendList',
            arguments: []
        })
        this.fl = v
        return v
    }

    /**
     * 获取好友列表，调用时会同步一次好友列表，所以此处返回的是同步前的好友列表
     *
     * 此方法在 oicq 是弃用的，但是 NeonBot 出于跨线程异步化的想法依然保留此方法，其行为和直接访问 this.fl 一致
     */
    getFriendList () {
        this.getFriendListAsync()
        return this.fl
    }

    /**
     * 获取陌生人列表
     *
     * 此方法在 oicq 是弃用的，但是 NeonBot 出于跨线程异步化的想法依然保留此方法，其行为和直接访问 this.sl 一致
     */
    getStrangerListAsync () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getStrangerList',
            arguments: []
        })
    }

    /**
     * 获取陌生人列表，调用时会同步一次陌生人列表，所以此处返回的是同步前的陌生人列表
     */
    getStrangerList () {
        this.getStrangerListAsync()
        return this.sl
    }

    /**
     * 获取群列表
     *
     * 此方法在 oicq 是弃用的，但是 NeonBot 出于跨线程异步化的想法依然保留此方法，其行为和直接访问 this.gl 一致
     */
    async getGroupListAsync () {
        const result = await this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getGroupList',
            arguments: []
        })
        this.gl = result
        return result
    }

    /**
     * 获取群列表，调用时会同步一次群组列表，所以此处返回的是同步前的群组列表
     */
    getGroupList () {
        this.getGroupListAsync()
        return this.gl
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
        this.gml.set(groupId, v)
        return v
    }

    /**
     * 获取陌生人资料
     */
    getStrangerInfo (userId: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getStrangerInfo',
            arguments: [userId] as Parameters<oicq.Client['getStrangerInfo']>
        })
    }

    /**
     * 获取群资料
     */
    getGroupInfo (groupId: number, noCache?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getGroupInfo',
            arguments: [groupId, noCache]
        })
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
        const gms = this.gml.get(v.group_id)
        if (gms) {
            gms.set(v.user_id, v)
        } else {
            this.getGroupMemberList(v.group_id)
        }
        return v
    }

    /**
     * 预处理消息，可能以后会开放给插件使用？
     */
    private preprocessMessage (message: oicq.Sendable) {
        // randomHashedMessage
        if (this.randomHashedMessage) {
            const ran = randomBytes(4).toString('hex')
            const msg = oicq.segment.mirai(JSON.stringify({ data: ran }))
            if (typeof message === 'string') {
                const parsed = [msg, message]
                return parsed
            } else if (message instanceof Array) {
                message.unshift(msg)
                return message
            } else {
                return [
                    msg,
                    message
                ]
            }
        } else {
            return message
        }
    }

    /**
     * 私聊
     */
    sendPrivateMsg (userId: number, message: oicq.Sendable, source?: oicq.Quotable) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendPrivateMsg',
            arguments: [userId, this.preprocessMessage(message), source]
            // eslint-disable-next-line camelcase
        })
    }

    /**
     * 群聊
     */
    sendGroupMsg (groupId: number, message: oicq.Sendable, source?: oicq.Quotable) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendGroupMsg',
            arguments: [groupId, this.preprocessMessage(message), source]
            // eslint-disable-next-line camelcase
        })
    }

    /**
     * 群临时会话，大多数时候可以使用私聊达到同样效果
     */
    sendTempMsg (groupId: number, userId: number, message: oicq.Sendable) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendTempMsg',
            arguments: [groupId, userId, this.preprocessMessage(message)]
            // eslint-disable-next-line camelcase
        })
    }

    /**
     * 讨论组
     */
    sendDiscussMsg (discussId: number, message: oicq.Sendable, source?: oicq.Quotable) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendDiscussMsg',
            arguments: [discussId, this.preprocessMessage(message), source]
            // eslint-disable-next-line camelcase
        })
    }

    /**
     * 撤回
     */
    deleteMsg (messageId: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'deleteMsg',
            arguments: [messageId]
        })
    }

    /**
     * 获取一条消息(无法获取被撤回的消息)
     */
    getMsg (messageId: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getMsg',
            arguments: [messageId]
        })
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
        })
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
        })
    }

    /**
     * 发群公告
     */
    sendGroupNotice (groupId: number, content: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendGroupNotice',
            arguments: [groupId, content]
        })
    }

    /**
     * 设置群名
     */
    setGroupName (groupId: number, groupName: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupName',
            arguments: [groupId, groupName]
        })
    }

    /**
     * 开启或关闭匿名
     */
    setGroupAnonymous (groupId: number, enable?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupAnonymous',
            arguments: [groupId, enable]
        })
    }

    /**
     * 全员禁言
     */
    setGroupWholeBan (groupId: number, enable?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupWholeBan',
            arguments: [groupId, enable]
        })
    }

    /**
     * 设置管理员
     */
    setGroupAdmin (groupId: number, userId: number, enable?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupAdmin',
            arguments: [groupId, userId, enable]
        })
    }

    /**
     * 设置群头衔
     */
    setGroupSpecialTitle (groupId: number, userId: number, specialTitle: string, duration?: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupSpecialTitle',
            arguments: [groupId, userId, specialTitle, duration]
        })
    }

    /**
     * 设置群名片
     */
    setGroupCard (groupId: number, userId: number, card: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupCard',
            arguments: [groupId, userId, card]
        })
    }

    /**
     * 踢人(不支持批量)
     */
    setGroupKick (groupId: number, userId: number, rejectAddRequest?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupKick',
            arguments: [groupId, userId, rejectAddRequest]
        })
    }

    /**
     * 禁言
     */
    setGroupBan (groupId: number, userId: number, duration?: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupBan',
            arguments: [groupId, userId, duration]
        })
    }

    /**
     * 禁言匿名玩家
     */
    setGroupAnonymousBan (groupId: number, flag: string, duration?: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupAnonymousBan',
            arguments: [groupId, flag, duration]
        })
    }

    /**
     * 退群
     */
    setGroupLeave (groupId: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupLeave',
            arguments: [groupId]
        })
    }

    /**
     * 戳一戳
     */
    sendGroupPoke (groupId: number, userId: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendGroupPoke',
            arguments: [groupId, userId]
        })
    }

    /**
     * 处理好友请求
     */
    setFriendAddRequest (flag: string, approve?: boolean, remark?: string, block?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setFriendAddRequest',
            arguments: [flag, approve, remark, block]
        })
    }

    /**
     * 处理群请求
     */
    setGroupAddRequest (flag: string, approve?: boolean, reason?: string, block?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupAddRequest',
            arguments: [flag, approve, reason, block]
        })
    }

    /**
     * 获取未处理的请求
     */
    getSystemMsg () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getSystemMsg',
            arguments: []
        })
    }

    /**
     * 该接口风控(只能添加群员)
     */
    addFriend (groupId: number, userId: number, comment?: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'addFriend',
            arguments: [groupId, userId, comment]
        })
    }

    /**
     * 删除好友
     */
    deleteFriend (userId: number, block?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'deleteFriend',
            arguments: [userId, block]
        })
    }

    /**
     * 邀请好友入群(不支持陌生人和批量)
     */
    inviteFriend (groupId: number, userId: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'inviteFriend',
            arguments: [groupId, userId]
        })
    }

    /**
     * 点赞(times默认1，不支持陌生人)
     */
    sendLike (userId: number, times?: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendLike',
            arguments: [userId, times]
        })
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
        this.nickname = nickname
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
        this.sex = [
            'unknown',
            'male',
            'female'
        ][gender] as oicq.Gender
        return v
    }

    /**
     * 设置生日(20201202的形式)
     */
    async setBirthday (birthday: string | number) {
        const v = await this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setBirthday',
            arguments: [birthday]
        })
        const birth = String(birthday)
        const year = birth.substring(0, 4)
        const mouth = birth.substring(4, 6)
        const day = birth.substring(6, 8)
        const birthDate = new Date(`${year}-${mouth}-${day} 00:00`)
        const today = new Date()
        const age = today.getFullYear() - birthDate.getFullYear()
        const m = today.getMonth() - birthDate.getMonth()
        if (m > 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            this.age = age - 1
        } else {
            this.age = age
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
        })
    }

    /**
     * 设置个人签名
     */
    setSignature (signature?: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setSignature',
            arguments: [signature]
        })
    }

    /**
     * 设置个人头像
     */
    setPortrait (file: Parameters<oicq.Client['setAvatar']>[0]) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setPortrait',
            arguments: [file]
        })
    }

    /**
     * 设置群头像
     */
    setGroupPortrait (groupId: number, file: Parameters<oicq.Client['setAvatar']>[0]) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupPortrait',
            arguments: [groupId, file]
        })
    }

    /**
     * 获取漫游表情
     */
    getRoamingStamp (noCache?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getRoamingStamp',
            arguments: [noCache]
        })
    }

    /**
     * 支持的域名：
     * tenpay.com | docs.qq.com | office.qq.com | connect.qq.com
     * vip.qq.com | mail.qq.com | qzone.qq.com | gamecenter.qq.com
     * mma.qq.com | game.qq.com | qqweb.qq.com | openmobile.qq.com
     * qun.qq.com | ti.qq.com |
     */
    getCookies (domain?: oicq.Domain) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getCookies',
            arguments: [domain]
        })
    }

    getCsrfToken () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getCsrfToken',
            arguments: []
        })
    }

    /**
     * 清空缓存文件 fs.rm need v14.14
     */
    cleanCache () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'cleanCache',
            arguments: []
        })
    }

    /**
     * 进入群文件系统
     */
    acquireGfs (groupId: number) {
        return new GFSProxy(groupId, (this.invoke('node-oicq-gfs-aquire', {
            groupId
        } as any) as Promise<{
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
            methodName: 'reloadFriendList',
            arguments: []
        })
    }

    /**
     * 重载群列表
     * 完成之前无法调用任何api，也不会上报任何事件
     */
    reloadGroupList () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'reloadGroupList',
            arguments: []
        })
    }

    /** 直接关闭连接 */
    terminate () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'terminate',
            arguments: []
        })
    }

    /** 置消息已读(message_id及之前的消息将全部变为已读) */
    reportReaded (messageId: string) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'reportReaded',
            arguments: [messageId]
        })
    }

    /** 发送一个业务包不等待返回 */
    writeUni (cmd: string, body: Uint8Array, seq?: number) {
        this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendUni',
            arguments: [cmd, body, seq]
        })
    }

    /** 发送一个业务包并等待返回 */
    sendUni (cmd: string, body: Uint8Array) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendUni',
            arguments: [cmd, body]
        })
    }

    /** dont use it if not clear the usage */
    sendOidb (cmd: string, body: Uint8Array, timeout?: number) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendOidb',
            arguments: [cmd, body, timeout]
        })
    }

    /** 触发一个oicq标准事件 */
    em (name?: string, data?: object) {
        this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'em',
            arguments: [name, data]
        })
    }

    /**
     * 释放对象，关闭通讯接口
     * `BotProxy` 的通讯一般由 NeonBot 自行管理，插件无需调用此函数
     */
    close () {
        this.port.close()
    }
}
