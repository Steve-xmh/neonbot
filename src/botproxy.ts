import { EventEmitter } from 'events'
import { parentPort } from 'worker_threads'
import { messages } from './messages'
import * as oicq from 'oicq'
import { logger } from '.'

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
    'system',
    'request.friend',
    'request.group.add',
    'request.group.invite',
    'request.group',
    'request',
    'message.private',
    'message.group',
    'message.discuss',
    'message',
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

/**
 * 在机器人线程里运行的代理机器人，将会转换 oicq 的各类方法调用及事件触发并发送至主线程处理
 *
 * 介于需要跨线程调用，所以此处所有的函数都是异步的
 */
export class BotProxy extends EventEmitter {
    private awaitingPromises = new Map<string, [(result: any) => void, (reason: any) => void]>()

    constructor (public readonly qqid: number) {
        super()
        parentPort!!.on('message', (value) => {
            const data = value as messages.BaseMessage
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
                const evt = (data as messages.NodeOICQEventMessage).value
                if (evt.eventName.startsWith('message')) {
                    if (evt.message_type === 'group') {
                        evt.reply = (message: any, autoEscape = false) => this.sendGroupMsg((evt as any).group_id, message, autoEscape)
                    } else {
                        evt.reply = (message: any, autoEscape = false) => this.sendPrivateMsg((evt as any).user_id, message, autoEscape)
                    }
                }
                this.emit(evt.eventName, evt)
            }
        })
    }

    private invoke (type: messages.EventNames, value?: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const msg = messages.makeMessage(type, value)
            this.awaitingPromises.set(msg.id, [resolve, reject])
            parentPort!!.postMessage(msg)
        })
    }

    private send (type: messages.EventNames, value?: any): string {
        const msg = messages.makeMessage(type, value)
        parentPort!!.postMessage(msg)
        return msg.id
    }

    /** 获取可用的插件列表，**仅核心插件可用，普通插件调用将会抛出错误** */
    getListPlugin () {
        return this.invoke('list-plugins') as Promise<string[]>
    }

    /** 对机器人启用插件，**仅核心插件可用，普通插件调用将会抛出错误** */
    enablePlugin (pluginId: string) {
        return this.invoke('enable-plugin', {
            qqId: this.qqid,
            pluginId
        }) as Promise<void>
    }

    /** 禁用插件，**仅核心插件可用，普通插件调用将会抛出错误** */
    disablePlugin (pluginId: string) {
        return this.invoke('disable-plugin', {
            qqId: this.qqid,
            pluginId
        }) as Promise<void>
    }

    getFriendList () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getFriendList'
        }) as Promise<oicq.Ret<oicq.Client['fl']>>
    }

    getStrangerList () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getStrangerList'
        }) as Promise<oicq.Ret<oicq.Client['sl']>>
    }

    getGroupList () {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'getGroupList'
        }) as Promise<oicq.Ret<oicq.Client['gl']>>
    }

    sendGroupMsg (groupId: number, messages: messages.OICQMessage, autoEscape: boolean = false) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendGroupMsg',
            arguments: [groupId, messages, autoEscape]
        }) as Promise<oicq.Ret>
    }

    sendPrivateMsg (userId: number, messages: messages.OICQMessage, autoEscape: boolean = false) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'sendPrivateMsg',
            arguments: [userId, messages, autoEscape]
        }) as Promise<oicq.Ret>
    }

    setGroupAddRequest (flag: string, approve?: boolean, reason?: string, block?: boolean) {
        return this.invoke('node-oicq-invoke', {
            qqId: this.qqid,
            methodName: 'setGroupAddRequest',
            arguments: [flag, approve, reason, block]
        }) as Promise<oicq.Ret>
    }
}
