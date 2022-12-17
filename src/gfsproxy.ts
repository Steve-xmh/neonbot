import { MessagePort } from 'worker_threads'
import * as oicq from 'icqq'
import { messages } from './messages'
import { logger } from '.'
import EventEmitter = require('events')
import { purifyObject, restoreObject } from './utils'

export class GFSProxyError extends Error { }

/**
 * 在机器人线程里运行的代理群文件对象
 *
 * 介于需要跨线程调用，所以此处所有的函数都是异步的
 */
export class GFSProxy extends EventEmitter {
    private awaitingPromises = new Map<string, [(result: any) => void, (reason: any) => void]>()
    private portReady = Symbol('port-ready')
    private closed = false
    private port?: MessagePort

    constructor (
        /** 群号 */
        public readonly gid: number,
        portReciever: Promise<MessagePort>
    ) {
        super()
        process.once('uncaughtException', (err) => {
            this.close() // 出错时关闭通讯接口
            logger.warn('发生未捕获错误，已停止 GFSProxy 接口：', err)
        })
        process.once('beforeExit', () => {
            this.close() // 退出时关闭通讯接口
        })
        portReciever.then((port) => {
            logger.debug('GFSProxy', '接收到通讯接口！', port)
            this.port = port
            this.port.on('message', (value) => {
                logger.debug('GFSProxy <-', value)
                const data = restoreObject(value) as messages.BaseMessage
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
        if (this.closed) {
            return Promise.reject(new GFSProxyError('通讯接口已关闭'))
        } else if (this.port) {
            return new Promise((resolve, reject) => {
                const msg = messages.makeMessage(type, value)
                logger.debug('GFSProxy ->', msg)
                this.awaitingPromises.set(msg.id, [resolve, reject])
                const { data, transferList } = purifyObject(msg)
                this.port!!.postMessage(data, transferList)
            })
        } else {
            return new Promise((resolve, reject) => {
                this.once(this.portReady, () => {
                    const msg = messages.makeMessage(type, value)
                    logger.debug('GFSProxy ->', msg)
                    this.awaitingPromises.set(msg.id, [resolve, reject])
                    const { data, transferList } = purifyObject(msg)
                    this.port!!.postMessage(data, transferList)
                })
            })
        }
    }

    /** 查看文件属性(尽量不要对目录使用此方法) */
    stat (fid: string) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'stat',
            arguments: [fid]
        }) as ReturnType<oicq.Gfs['stat']>
    }

    /** 列出文件，start从0开始，limit默认100(最大) */
    ls (fid?: string, start?: number, limit?: number) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'ls',
            arguments: [fid, start, limit]
        }) as ReturnType<oicq.Gfs['ls']>
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
        }) as ReturnType<oicq.Gfs['mkdir']>
    }

    /** 删除文件或目录(删除目标是目录的时候会删除下面的所有文件) */
    rm (fid: string) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'rm',
            arguments: [fid]
        }) as ReturnType<oicq.Gfs['rm']>
    }

    /** 重命名文件或目录 */
    rename (fid: string, name: string) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'rename',
            arguments: [fid, name]
        }) as ReturnType<oicq.Gfs['rename']>
    }

    /** 移动文件到其他目录 */
    mv (fid: string, pid: string) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'mv',
            arguments: [fid, pid]
        }) as ReturnType<oicq.Gfs['mv']>
    }

    /** 查看可用空间和文件数量 */
    df () {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'df',
            arguments: []
        }) as ReturnType<oicq.Gfs['df']>
    }

    /**
     * 上传文件，可以是文件路径或者 Buffer 数据
     *
     * 注：NeonBot 暂不支持上传进度回调（TODO）
     * @param pathOrBuffer 需要上传的文件路径或者 Buffer 数据
     * @param pid 需要上传到的文件夹 ID
     * @param name 文件名称
     * @param callback 上传进度回调（暂不会调用）
     * @returns 上传成功后的文件信息
     */
    upload (pathOrBuffer: string | Buffer, pid?: string, name?: string, callback?: (percentage: string) => void) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'upload',
            arguments: [pathOrBuffer, pid, name]
        }) as ReturnType<oicq.Gfs['upload']>
    }

    download (fid: string) {
        return this.invoke('node-oicq-gfs-invoke', {
            methodName: 'download',
            arguments: [fid]
        }) as ReturnType<oicq.Gfs['download']>
    }

    /**
     * 释放对象，关闭通讯接口
     * `GFSProxy` 的通讯一般由 NeonBot 自行管理，插件无需调用此函数
     */
    close () {
        this.port?.close()
        this.closed = true
        logger.warn('GFSProxy 已关闭！')
    }
}
