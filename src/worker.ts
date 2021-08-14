import { Client, createClient, Gfs } from 'oicq'
import { TransferListItem, Worker, WorkerOptions, MessagePort, parentPort, MessageChannel } from 'worker_threads'
import { botWorkers, config, corePluginWorkers, logger, pluginWorkers, indexPath } from '.'
import { acceptableEvents, BotProxy } from './botproxy'
import { loadConfig, saveConfig } from './config'
import corePlugins from './core-plugins'
import { messages } from './messages'
import NeonPlugin, { disablePlugin, enablePlugin, listPluginErrorOutputs, listPlugins, shutdownPlugin } from './plugin'
import { randonID } from './utils'

export interface WorkerStatus {
    usedMemory: number
}

export class NeonWorker extends Worker {
    public ready: boolean = false
    private waitReadyPromises: [Function, Function][] = []

    constructor (stringUrl: string | URL, options?: WorkerOptions) {
        super(stringUrl, options)
        this.on('message', this.onReadyMessage)
    }

    postMessage (value: messages.BaseMessage | messages.BaseResult, transferList?: ReadonlyArray<TransferListItem>) {
        if (this.ready || ('type' in value && value.type === 'deploy-worker')) {
            Worker.prototype.postMessage.call(this, value, transferList)
        } else {
            this.waitReady().then(() => {
                Worker.prototype.postMessage.call(this, value, transferList)
            })
        }
    }

    /**
     * 当线程部署完毕时返回，即线程完成执行 `depoly-worker` 类型消息时
     * 因为 Worker 不保证发送消息时的发送顺序，所以在部署事件完成之前不能处理其他操作
     */
    private waitReady (): Promise<void> {
        if (this.ready) {
            return Promise.resolve()
        } else {
            return new Promise((resolve, reject) => {
                this.waitReadyPromises.push([resolve, reject])
            })
        }
    }

    private onReadyMessage (value: messages.BaseMessage) {
        if (value.type === 'worker-ready') {
            this.ready = true
            this.off('message', this.onReadyMessage)
            for (const [resolve] of this.waitReadyPromises) { resolve() }
        }
    }
}

async function onCoreTypeMessage (this: NeonWorker, data: messages.BaseMessage) {
    if (data.type === 'list-plugins') {
        this.postMessage({
            id: data.id,
            type: data.type,
            succeed: true,
            value: await listPlugins()
        } as messages.BaseResult)
    } else if (data.type === 'enable-plugin') {
        const qqid = (data as messages.SetPluginMessage).value.qqId
        const pluginId = (data as messages.SetPluginMessage).value.pluginId
        if (qqid && pluginId) {
            await enablePlugin(qqid, pluginId)
        }
        this.postMessage({
            id: data.id,
            type: data.type,
            succeed: true,
            value: data.value
        } as messages.BaseResult)
    } else if (data.type === 'disable-plugin') {
        const qqid = (data as messages.SetPluginMessage).value.qqId
        const pluginId = (data as messages.SetPluginMessage).value.pluginId
        if (qqid && pluginId) {
            if (botProxies.has(qqid)) {
                await disablePlugin(qqid, pluginId)
            }
        }
        this.postMessage({
            id: data.id,
            type: data.type,
            succeed: true,
            value: data.value
        } as messages.BaseResult)
    } else if (data.type === 'reload-plugin') {
        const pluginId = (data as messages.SetPluginMessage).value.pluginId
        // Post disable data to plugin for all bots
        if (pluginId) {
            const proxy = pluginWorkers.get(pluginId)
            if (proxy) {
                const pluginConfigs = await loadConfig()
                if (pluginId in pluginConfigs) {
                    const qqids = [...pluginConfigs[pluginId].enabledQQIds]
                    for (const qqId of qqids) {
                        await disablePlugin(qqId, pluginId)
                    }
                    await shutdownPlugin(pluginId)
                    for (const qqId of qqids) {
                        await enablePlugin(qqId, pluginId)
                    }
                }
            }
        }
        this.postMessage({
            id: data.id,
            type: data.type,
            succeed: true,
            value: data.value
        } as messages.BaseResult)
    } else if (data.type === 'get-workers-status') {
        const result: messages.GetWorkersStatusResult['value'] = {
            corePluginWorkers: {},
            pluginWorkers: {},
            botWorkers: {}
        }
        this.postMessage({
            id: data.id,
            type: data.type,
            succeed: true,
            value: result
        } as messages.BaseResult)
    } else if (data.type === 'list-plugin-error-outputs') {
        this.postMessage({
            id: data.id,
            type: data.type,
            succeed: true,
            value: await listPluginErrorOutputs()
        } as messages.BaseResult)
    } else if (data.type === 'save-config') {
        const {
            qqId,
            pluginId,
            pluginData
        } = (data as messages.SaveConfigMessage).value
        const pluginConfig = (await loadConfig())[pluginId] || {
            enabledQQIds: [],
            localSavedData: {},
            savedData: undefined
        }
        if (qqId) {
            if (pluginData === undefined) {
                delete pluginConfig.localSavedData[qqId]
            } else {
                pluginConfig.localSavedData[qqId] = pluginData
            }
        } else {
            if (pluginData === undefined) {
                delete pluginConfig.savedData
            } else {
                pluginConfig.savedData = pluginData
            }
        }
        await saveConfig()
    }
}

interface BotGFSSetItem {
    gfs: Gfs
    port: MessagePort
}

let bot: Client
let plugin: NeonPlugin
const botProxies = new Map<number, BotProxy>()
const pluginPorts = new Set<MessagePort>()
const botGfses = new Set<BotGFSSetItem>()
const invokeIds = new Map<string, string>()

export function createCorePluginWorker (plugin: NeonPlugin) {
    const pluginWorker = new NeonWorker(indexPath, {
        workerData: {
            logger: `[NCP:${plugin.shortName}]`,
            loggerLevel: config.loggerLevel
        }
    })
    pluginWorker.postMessage({
        id: randonID(),
        type: 'deploy-worker',
        value: {
            workerType: messages.WorkerType.CorePlugin,
            pluginId: plugin.id,
            config: {
                admins: [...config.admins]
            }
        }
    } as messages.DeployWorkerMessage<messages.DeployCorePluginWorkerData>)
    pluginWorker.once('error', (err) => {
        logger.warn(`核心插件 ${plugin.name || plugin.shortName || plugin.id} 线程发生错误，正在尝试重启`, err)
        setTimeout(() => {
            corePluginWorkers.set(plugin.id, createCorePluginWorker(plugin))
        }, 5000)
    })
    pluginWorker.on('message', async (data: messages.BaseMessage) => {
        if (data.type === 'node-oicq-invoke') {
            invokeIds.set(data.id, plugin.id)
            const invokeData = (data as messages.NodeOICQInvokeMessage).value
            const bot = botWorkers.get(invokeData.qqId)
            if (bot) {
                bot.postMessage(data)
            } else {
                pluginWorker.postMessage({
                    id: data.id,
                    type: data.type,
                    succeed: false,
                    value: '无法找到机器人'
                } as messages.BaseResult)
            }
        } else {
            await onCoreTypeMessage.call(pluginWorker, data)
        }
    })
    pluginWorker.once('online', () => {
        for (const [qqId, botWorker] of botWorkers) {
            const ports = new MessageChannel()
            botWorker.postMessage({
                id: randonID(),
                type: 'connect-plugin',
                value: {
                    qqId,
                    pluginType: messages.WorkerType.CorePlugin,
                    port: ports.port1
                }
            } as messages.ConnectPluginMessage, [ports.port1])
            pluginWorker.postMessage({
                id: randonID(),
                type: 'enable-plugin',
                value: {
                    qqId,
                    port: ports.port2
                }
            } as messages.SetPluginMessage, [ports.port2])
        }
    })
    return pluginWorker
}

export async function createPluginWorker (pluginPath: string, pluginId: string, shortName: string, name?: string) {
    const pluginWorker = new NeonWorker(indexPath, {
        workerData: {
            logger: `[NP:${shortName}]`,
            loggerLevel: config.loggerLevel
        }
    })
    const pluginData = (await loadConfig())[pluginId].savedData
    pluginWorker.postMessage({
        id: randonID(),
        type: 'deploy-worker',
        value: {
            workerType: messages.WorkerType.Plugin,
            pluginPath: pluginPath,
            config: {
                admins: [...config.admins],
                pluginData
            }
        }
    } as messages.DeployWorkerMessage<messages.DeployPluginWorkerData>)
    pluginWorker.once('exit', () => {
        pluginWorkers.delete(pluginId)
    })
    pluginWorker.once('error', (err) => {
        logger.warn(`插件 ${name || shortName || pluginId} 线程发生错误，正在尝试重启`, err)
        setTimeout(async () => {
            pluginWorkers.set(pluginId, await createPluginWorker(pluginPath, pluginId, shortName, name))
        }, 5000)
    })
    pluginWorker.on('message', async (data: messages.BaseMessage) => {
        if (data.type === 'node-oicq-invoke') {
            invokeIds.set(data.id, pluginId)
            const invokeData = (data as messages.NodeOICQInvokeMessage).value
            const bot = botWorkers.get(invokeData.qqId)
            if (bot) {
                bot.postMessage(data)
            } else {
                pluginWorker.postMessage({
                    id: data.id,
                    type: data.type,
                    succeed: false,
                    value: '无法找到机器人'
                } as messages.BaseResult)
            }
        } else {
            await onCoreTypeMessage.call(pluginWorker, data)
        }
    })
    return pluginWorker
}

export function createBotWorker (qqId: number) {
    const botConfig = {
        ...config.accounts[qqId],
        data_dir: config.dataDir
    }
    const botWorker = new NeonWorker(indexPath, {
        workerData: {
            logger: `[NBot#${qqId}]`,
            loggerLevel: config.loggerLevel
        }
    })
    botWorker.postMessage({
        id: randonID(),
        type: 'deploy-worker',
        value: {
            workerType: messages.WorkerType.Bot,
            qqid: qqId,
            config: botConfig
        }
    } as messages.DeployWorkerMessage<messages.DeployBotWorkerData>)
    botWorker.once('exit', () => {
        botWorkers.delete(qqId)
    })
    botWorker.once('error', (err) => {
        logger.warn(`机器人 #${qqId} 线程发生错误，正在尝试重启`, err)
        setTimeout(() => {
            botWorkers.set(qqId, createBotWorker(qqId))
        }, 5000)
    })
    botWorker.on('message', async (data: messages.BaseMessage) => {
        if (data.type === 'node-oicq-event') {
            const evt = (data as messages.NodeOICQEventMessage).value
            if (evt.post_type === 'message' && evt.message_type === 'private') {
                if (config.admins.includes(data.value.user_id)) {
                    for (const [, plugin] of corePluginWorkers) {
                        plugin.postMessage(data)
                    }
                }
            }
            for (const [, plugin] of pluginWorkers) {
                plugin.postMessage(data)
            }
        } else if (data.type === 'node-oicq-invoke') {
            const pluginId = invokeIds.get(data.id)!!
            const corePlugin = corePluginWorkers.get(pluginId)
            const plugin = pluginWorkers.get(pluginId)
            if (corePlugin) {
                corePlugin.postMessage(data)
            } else if (plugin) {
                plugin.postMessage(data)
            } else {
                logger.warn('未知 ID 的回调信息被传回：', data)
            }
        }
    })
    return botWorker
}

export async function onWorkerMessage (this: NeonWorker, message: messages.BaseMessage) {
    if ('succeed' in message) {
        return // 这是消息，不处理
    }
    logger.debug(message)
    switch (message.type) {
    case 'deploy-worker':
    {
        const data = message.value as messages.DeployWorkerData
        if (data.workerType === messages.WorkerType.Bot) {
            logger.info('正在登录账户')
            const qqid = (data as messages.DeployBotWorkerData).qqid
            const config = (data as messages.DeployBotWorkerData).config
            bot = createClient(qqid, {
                log_level: logger.level as any || 'debug',
                ...config
            })
            bot.on('system.online', () => {
                logger.info('账户已登录上线，开始接收消息')
            })
            bot.on('system.offline', (event) => {
                logger.warn('账户已离线，正在重新登录')
                bot.login()
            })
            bot.on('system.login', (event) => {
                switch (event.sub_type) {
                case 'device': {
                    logger.warn('检测到设备锁，请完成验证后重启机器人以继续登录', event.url)
                    break
                }
                case 'error': {
                    logger.error('登录账户失败', `#${event.code}`, event.message)
                    break
                }
                case 'slider': {
                    logger.warn('检测到滑动验证，请完成验证后后在控制台内输入', 'verify ' + qqid + ' [token]', '以继续登录', event.url)
                    break
                }
                }
            })
            for (const eventName of acceptableEvents) {
                bot.on(eventName, (data) => {
                    data.eventName = eventName
                    if ('reply' in data) {
                        delete data.reply
                    }
                    const postData: messages.NodeOICQEventMessage = {
                        id: randonID(),
                        type: 'node-oicq-event',
                        value: data
                    }
                    for (const port of pluginPorts) {
                        port.postMessage(postData)
                    }
                })
            }
            bot.login(config.password)
        } else if (data.workerType === messages.WorkerType.CorePlugin) {
            const pluginId = (data as messages.DeployCorePluginWorkerData).pluginId
            const config = (data as messages.DeployCorePluginWorkerData).config
            config.logger = logger
            logger.info('正在初始化核心插件', pluginId)
            const iplugin = corePlugins.find((v) => v.id === pluginId)
            if (iplugin) {
                plugin = iplugin
                if (plugin.init) await plugin.init(config)
                logger.info('核心插件初始化完毕')
            } else {
                logger.error('找不到核心插件', pluginId)
            }
        } else if (data.workerType === messages.WorkerType.Plugin) {
            logger.info('正在初始化插件')
            const pluginPath = (data as messages.DeployPluginWorkerData).pluginPath
            const config = (data as messages.DeployPluginWorkerData).config
            config.logger = logger
            delete require.cache[pluginPath]
            const iplugin = require(pluginPath) as NeonPlugin
            if (iplugin) {
                plugin = iplugin
                if (plugin.init) await plugin.init(config)
                logger.info('插件初始化完毕')
            } else {
                logger.error('找不到核心插件', pluginPath)
            }
        }
        this.postMessage({
            type: 'worker-ready'
        } as messages.BaseMessage)
        break
    }
    case 'enable-plugin':
    {
        const port = (message as messages.SetPluginMessage).value.port || parentPort
        if (!(port && port instanceof MessagePort)) {
            logger.warn('通信接口类型不正确')
            break
        }
        const pluginMessage = (message as messages.SetPluginMessage).value
        if (!(port && port instanceof MessagePort)) {
            logger.warn('通信接口类型不正确')
            break
        }
        const qqid = pluginMessage.qqId
        if (qqid) {
            if (!botProxies.has(qqid)) {
                const proxy = new BotProxy(qqid, port)
                if (plugin.enable) await plugin.enable(proxy, (message as messages.SetPluginMessage).value.pluginData)
                botProxies.set(qqid, proxy)
            }
        }
        break
    }
    case 'verify-message':
    {
        if (bot) {
            bot.sliderLogin(message.value.token)
        } else {
            logger.warn('机器人尚未初始化，无法验证！')
        }
        break
    }
    case 'stop-bot':
    {
        if (bot) {
            for (const port of pluginPorts) {
                port.close()
            }
            setTimeout(() => {
                logger.info('等待登出超时，强制停止机器人线程中')
                process.exit()
            }, 5 * 1000)
            await bot.logout()
        }
        break
    }
    case 'connect-plugin':
    {
        // Bot Thread 连接 Plugin Thread
        const port = (message as messages.ConnectPluginMessage).value.port
        const pluginType = (message as messages.ConnectPluginMessage).value.pluginType
        if (!(port && port instanceof MessagePort)) {
            logger.warn('通信接口类型不正确')
            break
        }
        port.once('close', () => {
            pluginPorts.delete(port)
        })
        port.on('message', async (message: messages.BaseMessage) => {
            logger.debug('<- Plugin', message)
            if (message.type === 'node-oicq-invoke') {
                const data = message as messages.NodeOICQInvokeMessage
                const invokeData = data.value
                if (typeof (bot as any)[invokeData.methodName] === 'function') {
                    try {
                        const value = await (bot as any)[invokeData.methodName](...(invokeData.arguments || []))
                        logger.debug(message.id, '->', value)
                        port.postMessage({
                            id: data.id,
                            succeed: true,
                            value
                        } as messages.BaseResult)
                    } catch (err) {
                        port.postMessage({
                            id: data.id,
                            succeed: false,
                            value: err
                        } as messages.BaseResult)
                    }
                } else {
                    port.postMessage({
                        id: data.id,
                        succeed: false,
                        value: `找不到 ${invokeData.methodName} 调用方法`
                    } as messages.BaseResult)
                }
            } else if (message.type === 'node-oicq-gfs-aquire') {
                const groupId = (message as messages.AquireGFSMessage)?.value?.groupId
                if (groupId) {
                    const ports = new MessageChannel()
                    const gfs = bot.acquireGfs(groupId)
                    const gfsObj = {
                        port: ports.port1,
                        gfs
                    }
                    botGfses.add(gfsObj)
                    gfsObj.port.on('message', async (message: messages.BaseMessage) => {
                        if (message.type === 'node-oicq-gfs-invoke') {
                            const data = message as messages.NodeOICQGFSInvokeMessage
                            const invokeData = data.value
                            if (typeof (gfsObj.gfs as any)[invokeData.methodName] === 'function') {
                                try {
                                    gfsObj.port.postMessage({
                                        id: data.id,
                                        succeed: true,
                                        value: await (gfsObj.gfs as any)[invokeData.methodName](...(invokeData.arguments || []))
                                    } as messages.BaseResult)
                                } catch (err) {
                                    gfsObj.port.postMessage({
                                        id: data.id,
                                        succeed: false,
                                        value: err
                                    } as messages.BaseResult)
                                }
                            } else {
                                gfsObj.port.postMessage({
                                    id: data.id,
                                    succeed: false,
                                    value: `找不到 ${invokeData.methodName} 调用方法`
                                } as messages.BaseResult)
                            }
                        }
                    })
                    gfsObj.port.once('close', () => {
                        botGfses.delete(gfsObj)
                    })
                    port.postMessage({
                        id: message.id,
                        succeed: true,
                        value: {
                            groupId,
                            port: ports.port2
                        }
                    } as messages.AquireGFSResult, [ports.port2])
                } else {
                    port.postMessage({
                        id: message.id,
                        succeed: false,
                        value: '请求群文件系统时未提供群号'
                    } as messages.BaseResult)
                }
            } else if (pluginType !== messages.WorkerType.CorePlugin) {
                port.postMessage({
                    id: message.id,
                    succeed: false,
                    value: '未知的调用消息'
                } as messages.BaseResult)
            } else {
                port.postMessage({
                    id: message.id,
                    succeed: false,
                    value: '未知的调用消息'
                } as messages.BaseResult)
            }
        })
        port.postMessage({
            id: randonID(),
            type: 'node-oicq-sync',
            value: {
                uin: bot?.uin,
                password_md5: new Uint8Array(bot.password_md5 || Buffer.alloc(0)),
                nickname: bot?.nickname,
                online: bot?.isOnline(),
                sex: bot?.sex,
                online_status: bot?.online_status,
                fl: bot?.fl,
                sl: bot?.sl,
                gl: bot?.gl,
                gml: bot?.gml,
                dir: bot?.dir,
                config: bot?.config,
                stat: bot?.stat
            }
        } as messages.NodeOICQSyncMessage)
        pluginPorts.add(port)
        break
    }
    case 'disable-plugin':
    {
        const qqId = (message as messages.SetPluginMessage).value.qqId
        if (qqId) {
            if (botProxies.has(qqId)) {
                const proxy = botProxies.get(qqId)
                if (proxy) {
                    if (plugin.disable) {
                        const pluginData = await plugin.disable(proxy)
                        parentPort?.postMessage({
                            type: 'save-config',
                            value: {
                                pluginId: plugin.id,
                                qqId,
                                pluginData
                            }
                        } as messages.SaveConfigMessage)
                    }
                    proxy.close()
                    botProxies.delete(qqId)
                }
            }
            if (botProxies.size === 0) {
                logger.info('已无任何机器人启用此插件，正在关闭插件线程以节省资源')
                if (plugin.uninit) {
                    const pluginData = await plugin.uninit()
                    parentPort?.postMessage({
                        type: 'save-config',
                        value: {
                            pluginId: plugin.id,
                            pluginData
                        }
                    } as messages.SaveConfigMessage)
                }
            }
        }
        break
    }
    case 'reload-plugin':
    {
        const value = (message as messages.SetPluginMessage).value
        const qqid = value.qqId
        if (qqid) {
            if (botProxies.has(qqid)) {
                const proxy = botProxies.get(qqid)
                if (proxy) {
                    if (plugin.disable) await plugin.disable(proxy)
                    const newProxy = new BotProxy(qqid, value.port)
                    botProxies.set(qqid, newProxy)
                    if (plugin.enable) await plugin.enable(newProxy, value.pluginData)
                }
            }
        }
        break
    }
    case 'list-plugins':
    case 'node-oicq-event':
    {
        // 在 BotProxy 内实现
        break
    }
    default:
    {
        logger.warn('未知（或暂未实现）的通信消息类型：', message.type)
    }
    }
}
