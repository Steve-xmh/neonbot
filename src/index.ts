import { isMainThread, parentPort, Worker, workerData } from 'worker_threads'
import * as log4js from 'log4js'
import { ConfBot } from 'oicq'
import { messages } from './messages'
import { randonID } from './utils'
import { resolve } from 'path'
import { setupConsole } from './console'
import corePlugins from './core-plugins'
import { createBotWorker, createCorePluginWorker, createPluginWorker, onWorkerMessage } from './worker'
import { readdir, stat } from 'fs/promises'
import NeonPlugin from './plugin'
import { loadConfig } from './config'

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
     * 用于搜索插件的目录清单，如果为空则为配置文件同文件夹中的 plugins 文件夹
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
     * 数据存储文件夹，如果为空则为配置文件同文件夹中的 data 文件夹
     */
    dataDir?: string
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
export const indexPath = __filename
export let config: NeonBotConfig

async function listPlugins () {
    const result: {
        [pluginKey: string]: {
            id: string,
            shortName: string,
            name?: string,
            pluginPath: string
        }
    } = {}
    for (const subdir of config.pluginSearchPath || []) {
        try {
            const plugins = await readdir(subdir)
            for (const pluginDir of plugins) {
                try {
                    const pluginPath = resolve(subdir, pluginDir)
                    if (!(await stat(pluginPath)).isDirectory()) continue
                    const plugin = require(pluginPath) as NeonPlugin
                    if (!plugin.id) continue
                    if (!plugin.shortName) continue
                    result[plugin.id] = ({
                        id: plugin.id,
                        shortName: plugin.shortName,
                        name: plugin.name,
                        pluginPath: pluginPath
                    })
                } catch {}
            }
        } catch {}
    }
    return result
}

async function enablePlugin (qqId: number, pluginId: string) {
    if (!botWorkers.has(qqId)) throw new Error('机器人 ' + qqId + '不存在')
    const plugins = await listPlugins()
    if (pluginId in plugins) {
        const plugin = plugins[pluginId]
        if (!pluginWorkers.has(plugin.id)) {
            // plugin.pluginPath
            const pluginWorker = createPluginWorker(plugin.pluginPath)
            pluginWorkers.set(plugin.id, pluginWorker)
        }
        const pluginWorker = pluginWorkers.get(plugin.id)
        pluginWorker!!.postMessage({
            type: 'enable-plugin',
            value: { qqId }
        } as messages.SetPluginMessage)
    } else {
        throw new Error('未找到插件 ' + pluginId + ' 可供机器人 ' + qqId + ' 使用')
    }
}

async function main () {
    if (isMainThread) {
        logger.info('NeonBot - by SteveXMH')
        if (process.argv.length < 3) {
            logger.info('使用方式：npm start [配置文件路径]')
        } else {
            const configPath = process.argv[process.argv.length - 1]
            logger.info('正在加载配置文件', configPath)
            config = require(configPath) as NeonBotConfig
            setupConsole()
            config.admins = config.admins || []
            config.pluginSearchPath = config.pluginSearchPath || [resolve(configPath, '../plugins')]
            config.pluginDataFile = config.pluginDataFile || resolve(configPath, '../plugins.json')
            if (config.admins.length === 0) {
                logger.fatal('请至少在配置文件内设置一名最高管理员，否则你将无法在聊天窗口内操作机器人！')
                process.exit(1)
            }
            if (!config.pluginDataFile) {
                logger.fatal('请在配置文件里设置插件数据文件路径，否则插件将无法保存自身数据！')
                process.exit(1)
            }
            if (config.pluginSearchPath.length === 0) {
                config.pluginSearchPath.push(resolve(configPath, '../plugins'))
            }
            config.dataDir = config.dataDir || resolve(configPath, '../data')
            logger.info('机器人数据文件夹：', config.dataDir)
            // Launch bots
            logger.info('正在启动机器人线程')
            for (const qqid in config.accounts) {
                botWorkers.set(parseInt(qqid), createBotWorker(parseInt(qqid)))
            }
            // Launch core plugins
            logger.info('正在启动核心插件线程')
            for (const plugin of corePlugins) {
                corePluginWorkers.set(plugin.id, createCorePluginWorker(plugin))
            }
            logger.info('正在读取插件配置文件')
            const pluginConfigs = await loadConfig()
            const plugins = await listPlugins()
            logger.info('正在加载已启用的插件')
            for (const pluginId in plugins) {
                const plugin = plugins[pluginId]
                const pluginConfig = pluginConfigs[pluginId]
                if (pluginConfig) {
                    const canEnable = !!pluginConfig.enabledQQIds.find(v => [...botWorkers.keys()].includes(v))
                    if (canEnable) {
                        for (const qqId of pluginConfig.enabledQQIds) {
                            if (botWorkers.has(qqId)) {
                                await enablePlugin(qqId, plugin.id)
                            }
                        }
                    }
                }
            }
        }
    } else {
        parentPort!!.on('message', onWorkerMessage)
    }
}

main()
