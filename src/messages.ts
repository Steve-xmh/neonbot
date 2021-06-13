/**
 * @fileoverview
 * 定义了各个工作线程与主线程的信息交换协议方式
 */

import { randomUUID } from 'crypto'
import { AccountConfig } from '.'
import { CommonEventData, ConfBot, MessageElem, Ret } from 'oicq'
import { randonID } from './utils'
import { InitConfig } from './plugin'
import { MessagePort } from 'worker_threads'

/** 消息类型命名空间 */
export namespace messages {

    export type EventNames =
        'deploy-worker' |
        'worker-ready' |
        'list-plugins' |
        'enable-plugin' |
        'connect-plugin' |
        'disable-plugin' |
        'reload-plugin' |
        'verify-message' |
        'node-oicq-event' |
        'node-oicq-invoke' |
        'node-oicq-gfs-aquire' |
        'node-oicq-gfs-invoke' |
        'get-save-data'

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
        config: AccountConfig & ConfBot
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

    export interface NodeOICQEventMessage extends BaseMessage {
        type: 'node-oicq-event'
        value: CommonEventData & {
            eventName: string
            // eslint-disable-next-line camelcase
            reply?: (message: OICQMessage, autoEscape?: boolean) => Promise<Ret<{ message_id: string }>>
        }
    }

    export interface NodeOICQInvokeMessage extends BaseMessage {
        type: 'node-oicq-invoke'
        value: {
            qqId: number
            methodName: string
            arguments: any[]
        }
    }

    export interface SetPluginMessage extends BaseMessage {
        type: 'enable-plugin' | 'disable-plugin' | 'reload-plugin'
        value: {
            qqId?: number
            port: MessagePort
            pluginId?: string
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

    export interface GetSaveDataMessage extends BaseMessage {
        type: 'get-save-data'
        value: {
            type: 'local' | 'global'
            qqid?: number
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
