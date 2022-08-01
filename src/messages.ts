/**
 * @fileoverview
 * 定义了各个工作线程与主线程的信息交换协议方式
 */

import { randomUUID } from 'crypto'
import { AccountConfig, BotProxy } from '.'
import { Client, Config, EventMap, FriendInfo, Gender, GroupInfo, MemberInfo, Message, MessageElem, Statistics, StrangerInfo } from 'oicq'
import { randonID } from './utils'
import { InitConfig } from './plugin'
import { MessagePort } from 'worker_threads'
import { WorkerStatus } from './worker'

/** 消息类型命名空间 */
export namespace messages {

    export type EventNames =
        'deploy-worker' |
        'bot-ready' |
        'worker-ready' |
        'list-plugins' |
        'list-plugin-error-outputs' |
        'get-workers-status' |
        'enable-plugin' |
        'connect-plugin' |
        'disable-plugin' |
        'reload-plugin' |
        'verify-message' |
        'node-oicq-sync' |
        'node-oicq-event' |
        'node-oicq-invoke' |
        'node-oicq-gfs-aquire' |
        'node-oicq-gfs-invoke' |
        'save-config' |
        'stop-bot' |
        'get-save-data' |
        'set-save-data'

    export enum WorkerType {
        // eslint-disable-next-line no-unused-vars
        Bot,
        // eslint-disable-next-line no-unused-vars
        CorePlugin,
        // eslint-disable-next-line no-unused-vars
        Plugin
    }

    export interface BaseMessage {
        /**
         * 该信息的唯一标识符，用于正确返回一些 Promise 调用
         */
        id: ReturnType<typeof randomUUID>
        /**
         * 消息的类型
         * @see {MessageType}
         */
        type: EventNames
        /** 传递的附带数据 */
        value: any
    }

    export interface BaseResult {
        /**
         * 该信息的唯一标识符，用于正确返回一些 Promise 调用
         * 通常和 BaseMessage 一同使用，且 ID 一致
         */
        id: ReturnType<typeof randomUUID>
        /**
         * 结果是否成功，成功则将 `value` 代入 `Promise.resolve` 触发，否则将 `value` 代入 `Promise.reject` 调用
         */
        succeed: boolean
        /** 返回的附带数据，将会作为调用的 `Promise.resolve` 参数返回 */
        value: any
    }

    export interface DeployWorkerData {
        workerType: WorkerType
    }

    export interface DeployBotWorkerData extends DeployWorkerData {
        workerType: WorkerType.Bot
        qqid: number
        config: AccountConfig & Config
    }

    export interface DeployPluginWorkerData extends DeployWorkerData {
        workerType: WorkerType.Plugin
        pluginPath: string
        config: InitConfig
    }

    export interface DeployCorePluginWorkerData extends DeployWorkerData {
        workerType: WorkerType.CorePlugin
        pluginId: string
        config: InitConfig
    }

    export interface DeployWorkerMessage<T extends DeployWorkerData> extends BaseMessage {
        type: 'deploy-worker'
        value: T
    }

    export interface VerifyMessage extends BaseMessage {
        type: 'verify-message'
        value: {
            token: string
        }
    }

    export type OICQMessage = MessageElem | Iterable<MessageElem> | string

    export interface NodeOICQEventMessage<T extends Message = Message> extends BaseMessage {
        type: 'node-oicq-event'
        eventName: keyof EventMap,
        value: T extends Message ? T : Message
    }

    // 类型体操，用来检测 BotProxy 是否完全实现了 oicq 的 api 们
    type OicqClientFunctions = {
        [M in keyof Client]: Client[M] extends (...args: any) => any ? M : never
    }
    type BotProxyFunctions = {
        [M in keyof BotProxy]: BotProxy[M] extends (...args: any) => any ? M : never
    }
    // 如果全部实现，那么这里应当是一个 never 类型
    type ExcludedClientFunctions = Exclude<keyof OicqClientFunctions, keyof BotProxyFunctions>
    // 如果没有完全实现，那么这里就会报错
    // eslint-disable-next-line no-unused-vars
    function _implementTest () {
        // eslint-disable-next-line no-unused-vars
        // const _test: ExcludedClientFunctions extends never ? undefined : never = undefined
    }

    export type ReturnTypeOfClientMethod<M extends keyof Client> = Client[M] extends (...args: any) => infer R ? (R extends Promise<infer PR> ? PR : R) : never

    export interface NodeOICQInvokeMessage<M extends keyof Client> extends BaseMessage {
        type: 'node-oicq-invoke'
        value: {
            qqId: number
            methodName: M
            arguments: Client[M] extends (...args: any) => any ? Parameters<Client[M]> : never
        }
    }

    /** 同步 Bot 线程的属性更新 */
    export interface NodeOICQSyncMessage extends BaseMessage {
        type: 'node-oicq-sync',
        value: {
            readonly uin: number;
            // eslint-disable-next-line camelcase
            readonly password_md5: Uint8Array;
            readonly nickname: string;
            readonly sex: Gender;
            readonly age: number;
            /** 在线状态 */
            readonly status: number;
            /** 是否在线 */
            readonly online: boolean;
            /** 好友列表 */
            readonly fl: Map<number, FriendInfo>;
            /** 陌生人列表 */
            readonly sl: Map<number, StrangerInfo>;
            /** 群列表 */
            readonly gl: Map<number, GroupInfo>;
            /** 群员列表 */
            readonly gml: Map<number, Map<number, MemberInfo>>;
            /** 当前账号本地存储路径 */
            readonly dir: string;
            /** 配置信息(大部分参数支持热修改) */
            readonly config: Required<Config>;
            /** 数据统计信息 */
            readonly stat: Statistics;
        }
    }

    export interface SetPluginMessage extends BaseMessage {
        type: 'enable-plugin' | 'disable-plugin' | 'reload-plugin'
        value: {
            qqId?: number
            port: MessagePort
            pluginId?: string
            pluginData: any
        }
    }

    export interface SaveConfigMessage extends BaseMessage {
        type: 'save-config'
        value: {
            pluginId: string
            qqId?: number
            pluginData: any
        }
    }

    /** 注：MessagePort 要在 transferList 里传输 */
    export interface ConnectPluginMessage extends BaseMessage {
        type: 'connect-plugin'
        value: {
            pluginType: WorkerType
            port: MessagePort
        }
    }

    export interface ListPluginMessage extends BaseMessage {
        type: 'list-plugins'
    }

    export interface ListPluginErrorOutputsMessage extends BaseMessage {
        type: 'list-plugin-error-outputs'
    }

    export interface GetWorkersStatusMessage extends BaseMessage {
        type: 'get-workers-status'
    }

    export interface GetWorkersStatusResult extends BaseResult {
        type: 'get-workers-status',
        value: {
            corePluginWorkers: { [pluginId: string]: WorkerStatus }
            pluginWorkers: { [pluginId: string]: WorkerStatus }
            botWorkers: { [qqId: number]: WorkerStatus }
        }
    }

    export interface StopBotMessage extends BaseMessage {
        type: 'stop-bot'
    }

    export interface GetSaveDataMessage extends BaseMessage {
        type: 'get-save-data'
        value: {
            pluginId: string
            qqid?: number
        }
    }

    export interface SetSaveDataMessage<T = any> extends BaseMessage {
        type: 'set-save-data'
        value: {
            pluginId: string
            qqid?: number
            data: T
        }
    }

    export interface AquireGFSMessage extends BaseMessage {
        type: 'node-oicq-gfs-aquire'
        value: {
            groupId: number
        }
    }

    export interface NodeOICQGFSInvokeMessage extends BaseMessage {
        type: 'node-oicq-gfs-invoke'
        value: {
            methodName: string
            arguments: any[]
        }
    }

    export interface AquireGFSResult extends BaseResult {
        value: {
            port: MessagePort
        }
    }

    export function makeMessage (type: EventNames, value: any): BaseMessage {
        return {
            type,
            id: randonID(),
            value
        }
    }

    export function makeResult (id: string, succeed: boolean, value: any): BaseResult {
        return {
            id,
            succeed,
            value
        }
    }
}
