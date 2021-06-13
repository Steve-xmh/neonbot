import { MessagePort } from 'worker_threads'
import * as oicq from 'oicq'
import { messages } from './messages'
import { logger } from '.'
import EventEmitter = require('events')

/**
 * 在机器人线程里运行的代理群文件对象
 *
 * 介于需要跨线程调用，所以此处所有的函数都是异步的
 *
 * 插件禁用或不再需要使用此函数时，需要调用 `GFSProxy.close` 以关闭通讯接口，否则会造成内存泄漏。
 */
export class GFSProxy extends EventEmitter {
    private awaitingPromises = new Map<string, [(result: any) => void, (reason: any) => void]>()
    private portReady = Symbol('port-ready')
    private port?: MessagePort

    constructor (
        /** 群号 */
        public readonly gid: number,
        portReciever: Promise<MessagePort>
    ) {
        super()
        process.once('uncaughtException', () => {
            this.close() // 出错时关闭通讯接口
        })
        process.once('beforeExit', () => {
            this.close() // 退出时关闭通讯接口
        })
        portReciever.then((port) => {
            this.port = port
            this.port.on('message', (value) => {
                logger.debug(value)
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
                } else {
                    logger.warn('接收到未知的 GFS 消息：', value)
                }
            })
            this.emit(this.portReady)
        })
    }

    /**
     * 向机器人线程发送调用消息，并等待返回数据
     * **不建议直接调用此函数，使用其他包装函数**
     * @param type 通讯消息类型
     * @param value 需要传递的数据
     * @returns 根据消息类型所传回的实际数据
     */
    invoke (type: messages.EventNames, value?: any): Promise<any> {
        if (this.port) {
            return new Promise((resolve, reject) => {
                const msg = messages.makeMessage(type, value)
                this.awaitingPromises.set(msg.id, [resolve, reject])
                this.port!!.postMessage(msg)
            })
        } else {
            return new Promise((resolve, reject) => {
                this.once(this.portReady, () => {
                    const msg = messages.makeMessage(type, value)
                    this.awaitingPromises.set(msg.id, [resolve, reject])
                    this.port!!.postMessage(msg)
                })
            })
        }
    }

    /** 查看文件属性(尽量不要对目录使用此方法) */
    stat (fid: string) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'stat',
            arguments: [fid]
        }) as Promise<oicq.GfsStat>
    }

    /** 列出文件，start从0开始，limit默认100(最大) */
    ls (fid?: string, start?: number, limit?: number) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'ls',
            arguments: [fid, start, limit]
        }) as Promise<oicq.GfsStat>
    }

    /** ls的别名，列出文件，start从0开始，limit默认100(最大) */
    dir (fid?: string, start?: number, limit?: number) {
        return this.ls(fid, start, limit)
    }

    /** 创建目录 */
    mkdir (name: string) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'mkdir',
            arguments: [name]
        }) as Promise<oicq.GfsDirStat>
    }

    /** 删除文件或目录(删除目标是目录的时候会删除下面的所有文件) */
    rm (fid: string) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'rm',
            arguments: [fid]
        }) as Promise<void>
    }

    /** 重命名文件或目录 */
    rename (fid: string, name: string) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'rename',
            arguments: [fid, name]
        }) as Promise<void>
    }

    /** 移动文件到其他目录 */
    mv (fid: string, pid: string) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'mv',
            arguments: [fid, pid]
        }) as Promise<void>
    }

    /** 查看可用空间和文件数量 */
    df () {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'df',
            arguments: []
        }) as Promise<{
            total: number,
            used: number,
            free: number,
            // eslint-disable-next-line camelcase
            file_count: number,
            // eslint-disable-next-line camelcase
            max_file_count: number,
        }>
    }

    upload (pathOrBuffer: string | Buffer | Uint8Array, pid?: string, name?: string) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'upload',
            arguments: [pathOrBuffer, pid, name]
        }) as Promise<oicq.GfsFileStat>
    }

    download (fid: string) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'download',
            arguments: [fid]
        }) as Promise<oicq.FileElem['data']>
    }

    /**
     * 释放对象，关闭通讯接口
     * `GFSProxy` 的通讯一般由 NeonBot 自行管理，插件无需调用此函数
     */
    close () {
        this.port?.close()
    }
}
