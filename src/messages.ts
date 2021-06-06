/**
 * @fileoverview
 * 定义了各个工作线程与主线程的信息交换协议方式
 */

import { randomUUID } from 'crypto'
import { AccountConfig } from '.'
import { CommonEventData, ConfBot, MessageElem, Ret } from 'oicq'
import { randonID } from './utils'
import { InitConfig } from './plugin'

/** 消息类型命名空间 */
export namespace messages {

    export type EventNames = 'listen-event-message' |
        'deploy-worker' |
        'enable-plugin' |
        'disable-plugin' |
        'verify-message' |
        'node-oicq-event' |
        'node-oicq-invoke' |
        'get-save-data'

    export enum WorkerType {
        Bot,
        CorePlugin,
        Plugin
    }

    export interface BaseMessage {
        /**
         * 该信息的唯一标识符，用于正确返回一些 Promise 调用
         */
        id: ReturnType<typeof randomUUID>,
        /**
         * 消息的类型
         * @see {MessageType}
         */
        type: EventNames,
        /** 传递的附带数据 */
        value: any
    }

    export interface BaseResult {
        /**
         * 该信息的唯一标识符，用于正确返回一些 Promise 调用
         * 通常和 BaseMessage 一同使用，且 ID 一致
         */
        id: ReturnType<typeof randomUUID>,
        /**
         * 结果是否成功，成功则将 `value` 代入 `Promise.resolve` 触发，否则将 `value` 代入 `Promise.reject` 调用
         */
        succeed: boolean,
        /** 返回的附带数据，将会作为调用的 `Promise.resolve` 参数返回 */
        value: any
    }

    export interface DeployWorkerData {
        workerType: WorkerType
    }

    export interface DeployBotWorkerData extends DeployWorkerData {
        workerType: WorkerType.Bot,
        qqid: number,
        config: AccountConfig & ConfBot
    }

    export interface DeployPluginWorkerData extends DeployWorkerData {
        workerType: WorkerType.Plugin,
        pluginPath: string
    }

    export interface DeployCorePluginWorkerData extends DeployWorkerData {
        workerType: WorkerType.CorePlugin,
        pluginId: string,
        config: InitConfig
    }

    export interface DeployWorkerMessage<T extends DeployWorkerData> extends BaseMessage {
        type: 'deploy-worker',
        value: T
    }

    export interface VerifyMessage extends BaseMessage {
        type: 'verify-message',
        value: {
            token: string
        }
    }

    export type OICQMessage = MessageElem | Iterable<MessageElem> | string

    export interface NodeOICQEventMessage extends BaseMessage {
        type: 'node-oicq-event'
        value: CommonEventData & {
            eventName: string,
            reply?: (message: OICQMessage, autoEscape?: boolean) => Promise<Ret>
        }
    }

    export interface NodeOICQInvokeMessage extends BaseMessage {
        type: 'node-oicq-invoke'
        value: {
            qqId: number,
            methodName: string,
            arguments: any[]
        }
    }

    export interface SetPluginMessage extends BaseMessage {
        type: 'enable-plugin' | 'disable-plugin'
        value: {
            qqId: number
        }
    }

    export interface GetSaveDataMessage extends BaseMessage {
        type: 'get-save-data',
        value: {
            type: 'local' | 'global',
            qqid?: number
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
