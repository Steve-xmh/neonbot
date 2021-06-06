import { isMainThread, parentPort, Worker, workerData } from 'worker_threads'
import * as log4js from 'log4js'
import { ConfBot } from 'oicq'
import { messages } from './messages'
import { randonID } from './utils'
import { resolve } from 'path'
import { setupConsole } from './console'
import corePlugins from './core-plugins'
import { onWorkerMessage } from './worker'

export const logger = log4js.getLogger(workerData?.logger || '[NeonBot]')
logger.level = 'debug'

export interface AccountConfig {
    /**
     * 账户的密码，可以使用明文字符串或 MD5 后的 Buffer
     * 为了你的账户安全，推荐通过使用环境变量导入而不是直接写在配置文件内
     */
    password: string | Buffer,
    /** 需要让机器人模拟运行的设备环境，默认为 `Platform.AndroidPhone` */
    platform?: Platform,
}

/**
 * 机器人的配置数据结构
 */
export interface NeonBotConfig {
    /**
     * 用于搜索插件的目录清单
     */
    pluginSearchPath?: string[]
    /**
     * 用于保存插件自身配置数据的文件路径，默认和配置文件同目录且命名为 `plugins.json`
     */
    pluginDataFile?: string
    /**
     * 最高管理员的 QQ 号码，只有在此列表的用户可以与核心插件交互
     */
    admins: number[]
    /**
     * 需要作为机器人的 QQ 账户配置，键值为 QQ 号码
     */
    accounts: { [qqid: number]: AccountConfig & ConfBot }
    /**
     * 数据存储文件夹，如果为空则与配置文件同文件夹
     */
    dataDir?: string
    /**
     * 数据存储文件夹，如果为空则与配置文件同文件夹
     */
    threadRestart?: string
}

export interface PluginConfig {
    [pluginId: string]: {
        /** 插件已向哪些 QQ 机器人账户启用 */
        enabledQQIds: number[]
        /** 插件的全局共享数据，可以自由设置 */
        savedData: any
        /** 插件的局部共享数据，以每个机器人账户独立，可以自由设置 */
        localSavedData: {
            [qqId: number]: any
        }
    }
}

/**
 * 需要让机器人模拟运行的设备环境，不同环境可能会导致部分事件或功能无法触发或使用，默认为 `Platform.AndroidPhone`
 */
export enum Platform {
    /** 安卓手机设备（默认） */
    AndroidPhone = 1,
    /** 安卓平板设备 */
    AndroidTablet = 2,
    /** 安卓手表设备 */
    AndroidWatch = 3,
    /** 苹果电脑系统 */
    MacOS = 4,
    /** 苹果平板设备 */
    IPad = 5
}

export const pluginWorkers = new Map<string, Worker>()
export const corePluginWorkers = new Map<string, Worker>()
export const botWorkers = new Map<number, Worker>()
const invokeIds = new Map<string, string>()

async function main () {
    if (isMainThread) {
        logger.info('NeonBot - by SteveXMH')
        if (process.argv.length < 3) {
            logger.info('使用方式：npm start [配置文件路径]')
        } else {
            const configPath = process.argv[process.argv.length - 1]
            logger.info('正在加载配置文件', configPath)
            const config = require(configPath) as NeonBotConfig
            setupConsole()
            config.admins = config.admins || []
            if (config.admins.length === 0) {
                logger.fatal('请至少在配置文件内设置一名最高管理员，否则你将无法在聊天窗口内操作机器人！')
                process.exit(1)
            }
            if (config.pluginDataFile) {
                logger.fatal('请在配置文件里设置插件数据文件路径，否则插件将无法保存自身数据！')
                process.exit(1)
            }
            config.dataDir = config.dataDir || resolve(configPath, '../data')
            logger.info('机器人数据文件夹：', config.dataDir)
            // Launch bots
            logger.info('正在启动机器人线程')
            for (const qqid in config.accounts) {
                const botConfig = {
                    ...config.accounts[qqid],
                    data_dir: config.dataDir
                }
                const botWorker = new Worker(__filename, {
                    workerData: {
                        logger: `[NBot#${qqid}]`
                    }
                })
                botWorker.postMessage({
                    id: randonID(),
                    type: 'deploy-worker',
                    value: {
                        workerType: messages.WorkerType.Bot,
                        qqid: parseInt(qqid),
                        config: botConfig
                    }
                } as messages.DeployWorkerMessage<messages.DeployBotWorkerData>)
                botWorker.once('error', (err) => {
                    logger.warn(`机器人 #${qqid} 线程发生错误，正在尝试重启`, err)
                })
                botWorker.on('message', (data: messages.BaseMessage) => {
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
                botWorkers.set(parseInt(qqid), botWorker)
            }
            // Launch core plugins
            logger.info('正在启动核心插件线程')
            for (const plugin of corePlugins) {
                const botWorker = new Worker(__filename, {
                    workerData: {
                        logger: `[NCP:${plugin.shortName}]`
                    }
                })
                botWorker.postMessage({
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
                botWorker.once('error', (err) => {
                    logger.warn(`核心插件 ${plugin.name || plugin.shortName || plugin.id} 线程发生错误，正在尝试重启`, err)
                })
                botWorker.on('message', (data: messages.BaseMessage) => {
                    if (data.type === 'node-oicq-invoke') {
                        invokeIds.set(data.id, plugin.id)
                        const invokeData = (data as messages.NodeOICQInvokeMessage).value
                        const bot = botWorkers.get(invokeData.qqId)
                        if (bot) {
                            bot.postMessage(data)
                        } else {
                            botWorker.postMessage({
                                id: data.id,
                                type: data.type,
                                succeed: false,
                                value: '无法找到机器人'
                            } as messages.BaseResult)
                        }
                    }
                })
                botWorker.once('online', () => {
                    for (const [qqId] of botWorkers) {
                        botWorker.postMessage({
                            id: randonID(),
                            type: 'enable-plugin',
                            value: {
                                qqId
                            }
                        } as messages.SetPluginMessage)
                    }
                })
                corePluginWorkers.set(plugin.id, botWorker)
            }
        }
    } else {
        logger.info('子线程已启动！')
        parentPort!!.on('message', onWorkerMessage)
    }
}

main()
